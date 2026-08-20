import mqtt from "mqtt";
import type { IClientOptions } from "mqtt";

import { HomieHaDiscoveryBridge } from "./HomieHaDiscoveryBridge";
import { validateDiscoveryMessage } from "./ha-discovery";
import { buildHomieMqttSubscriptions, type MqttQoS } from "./subscriptions";
import { parseHomieTopic } from "./topic";
import type {
  DiscoveryMessage,
  HomieHaDiscoveryOptions,
  HomieMajorVersion,
  MqttMessageInput,
} from "./types";

type MqttBridgeEvent = "connect" | "close" | "error" | "message" | "reconnect" | "offline";

type MessagePacket = { retain?: boolean };

export interface MqttBridgeLogger {
  debug?(message: string): void;
  info?(message: string): void;
  warn?(message: string): void;
  error?(message: string): void;
}

export interface MqttBridgeClient {
  on(event: MqttBridgeEvent, listener: (...args: unknown[]) => void): this;
  subscribeAsync(subscriptions: Record<string, { qos: MqttQoS }>): Promise<unknown>;
  publishAsync(
    topic: string,
    payload: string | Buffer,
    options: { qos: MqttQoS; retain: boolean },
  ): Promise<unknown>;
  endAsync(): Promise<void>;
}

export type MqttClientFactory = (
  brokerUrl: string,
  options: IClientOptions | undefined,
) => Promise<MqttBridgeClient>;

export interface HomieHaDiscoveryMqttBridgeOptions extends HomieHaDiscoveryOptions {
  brokerUrl: string;
  mqttOptions?: IClientOptions;
  subscriptionQos?: MqttQoS;
  logger?: MqttBridgeLogger;
  clientFactory?: MqttClientFactory;
}

export interface HomieHaDiscoveryMqttMetrics {
  messagesReceived: number;
  messagesPublished: number;
  publishFailures: number;
  validationFailures: number;
  reseedPublished: number;
  reseedCount: number;
  subscriptions: number;
  commits: number;
  discards: number;
  reconnects: number;
}

const defaultMqttClientFactory: MqttClientFactory = async (brokerUrl, options) =>
  await mqtt.connectAsync(brokerUrl, options);

const toMqttPayload = (message: DiscoveryMessage): string =>
  typeof message.payload === "string" ? message.payload : JSON.stringify(message.payload);

export class HomieHaDiscoveryMqttBridge {
  private readonly discoveryBridge: HomieHaDiscoveryBridge;
  private readonly clientFactory: MqttClientFactory;
  private readonly homieDomain: string;
  private readonly legacyRoot: string;
  private client: MqttBridgeClient | null = null;
  private messageQueue: Promise<void> = Promise.resolve();
  private readonly metrics: HomieHaDiscoveryMqttMetrics = {
    messagesReceived: 0,
    messagesPublished: 0,
    publishFailures: 0,
    validationFailures: 0,
    reseedPublished: 0,
    reseedCount: 0,
    subscriptions: 0,
    commits: 0,
    discards: 0,
    reconnects: 0,
  };

  public constructor(private readonly options: HomieHaDiscoveryMqttBridgeOptions) {
    this.homieDomain = options.homieDomain?.trim() || "homie";
    this.legacyRoot = options.legacyRoot?.trim() || "homie";
    this.discoveryBridge = new HomieHaDiscoveryBridge({
      ...options,
      homieDomain: this.homieDomain,
      legacyRoot: this.legacyRoot,
      autoApply: false,
    });
    this.clientFactory = options.clientFactory ?? defaultMqttClientFactory;
  }

  /** Connect to the broker and subscribe to the configured Homie metadata topics. */
  public async start(): Promise<void> {
    if (this.client) {
      return;
    }

    const client = await this.clientFactory(this.options.brokerUrl, this.options.mqttOptions);
    this.client = client;
    client.on("message", (topic, payload, packet) => {
      if (typeof topic !== "string") {
        return;
      }

      const payloadBuffer = Buffer.isBuffer(payload)
        ? payload
        : typeof payload === "string"
          ? Buffer.from(payload)
          : payload instanceof Uint8Array
            ? Buffer.from(payload)
            : null;
      if (payloadBuffer === null) {
        return;
      }

      const retain =
        typeof packet === "object" && packet !== null && (packet as MessagePacket).retain === true;

      this.enqueueTask(() =>
        this.handleMessage({
          topic,
          payload: payloadBuffer,
          retain,
        }),
      );
    });

    client.on("connect", () => {
      this.enqueueTask(() => this.handleConnected());
    });
    client.on("reconnect", () => {
      this.metrics.reconnects += 1;
    });

    await this.subscribeHomieTopics();
  }

  public getMetrics(): HomieHaDiscoveryMqttMetrics {
    return { ...this.metrics };
  }

  /** Drain queued messages and close the MQTT client. */
  public async stop(): Promise<void> {
    await this.flush();
    const client = this.client;
    this.client = null;
    if (client) {
      await client.endAsync();
    }
  }

  /** Return queued message handlers for deterministic completion in tests and tooling. */
  public async flush(): Promise<void> {
    await this.messageQueue;
  }

  private enqueueTask(task: () => Promise<void>): void {
    this.messageQueue = this.messageQueue.then(task).catch((error: unknown) => {
      this.metrics.publishFailures += 1;
      this.options.logger?.error?.(
        `MQTT adapter task failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }

  private buildSubscriptions(): Record<string, { qos: MqttQoS }> {
    const qos: MqttQoS = this.options.subscriptionQos ?? 1;
    return buildHomieMqttSubscriptions({
      homieDomain: this.homieDomain,
      legacyRoot: this.legacyRoot,
      enabledVersions: this.options.enabledVersions,
      includeAttributeDiagnostics: this.options.includeAttributeDiagnostics,
      qos,
    });
  }

  private async subscribeHomieTopics(): Promise<void> {
    const client = this.client;
    if (!client) {
      return;
    }

    const subscriptions = this.buildSubscriptions();
    await client.subscribeAsync(subscriptions);
    this.metrics.subscriptions += 1;
    this.options.logger?.info?.(
      `Subscribed to ${Object.keys(subscriptions).length} Homie MQTT topic pattern(s).`,
    );
  }

  private async handleConnected(): Promise<void> {
    await this.reseedState();
  }

  private async reseedState(): Promise<void> {
    const reseedMessages = this.discoveryBridge.reseed();
    if (reseedMessages.length === 0) {
      return;
    }

    this.metrics.reseedCount += 1;
    await this.publishMessages(reseedMessages, { commit: false });
    this.metrics.reseedPublished += reseedMessages.length;
    this.options.logger?.info?.(
      `Reseeded ${reseedMessages.length} Home Assistant discovery message(s).`,
    );
  }

  private async publishMessages(
    messages: DiscoveryMessage[],
    options: { commit: boolean; baseTopic?: string },
  ): Promise<void> {
    const client = this.client;
    if (!client || messages.length === 0) {
      return;
    }

    for (const message of messages) {
      await client.publishAsync(message.topic, toMqttPayload(message), {
        qos: message.qos,
        retain: message.retain,
      });
      this.metrics.messagesPublished += 1;
      this.options.logger?.debug?.(`Published discovery message to '${message.topic}'.`);
    }

    if (options.commit && options.baseTopic) {
      const committed = this.discoveryBridge.commit(options.baseTopic);
      this.metrics.commits += committed;
    }
  }

  private async handleMessage(input: MqttMessageInput): Promise<void> {
    const parsedTopic = parseHomieTopic(input.topic, {
      homieDomain: this.homieDomain,
      legacyRoot: this.legacyRoot,
    });
    const affectedBaseTopic = parsedTopic?.baseTopic;
    const result = this.discoveryBridge.ingest(input);

    this.metrics.messagesReceived += 1;
    for (const warning of result.warnings) {
      this.options.logger?.warn?.(warning);
    }
    for (const log of result.logs) {
      this.options.logger?.info?.(log);
    }

    const validationErrors = result.messages.flatMap((message) => {
      const errors = validateDiscoveryMessage(message);
      return errors.map((error) => `Invalid discovery message '${message.topic}': ${error}`);
    });
    if (validationErrors.length > 0) {
      this.metrics.validationFailures += 1;
      if (affectedBaseTopic) {
        this.discoveryBridge.discard(affectedBaseTopic);
        this.metrics.discards += 1;
      }
      for (const validationError of validationErrors) {
        this.options.logger?.error?.(validationError);
      }
      return;
    }

    try {
      await this.publishMessages(result.messages, {
        commit: true,
        baseTopic: affectedBaseTopic,
      });
    } catch (error: unknown) {
      if (affectedBaseTopic) {
        this.metrics.discards += this.discoveryBridge.discard(affectedBaseTopic);
      }
      this.metrics.publishFailures += 1;
      this.options.logger?.error?.(
        `Failed to process MQTT message '${input.topic}': ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return;
    }
  }
}

export const toEnabledVersions = ({
  enableV3 = true,
  enableV4 = true,
  enableV5 = true,
}: {
  enableV3?: boolean;
  enableV4?: boolean;
  enableV5?: boolean;
} = {}): HomieMajorVersion[] => {
  const versions: HomieMajorVersion[] = [];
  if (enableV3) versions.push(3);
  if (enableV4) versions.push(4);
  if (enableV5) versions.push(5);
  return versions;
};
