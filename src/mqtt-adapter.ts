import mqtt from "mqtt";
import type { IClientOptions } from "mqtt";

import { HomieHaDiscoveryBridge } from "./HomieHaDiscoveryBridge";
import { buildHomieMqttSubscriptions, type MqttQoS } from "./subscriptions";
import type {
  DiscoveryMessage,
  HomieHaDiscoveryOptions,
  HomieMajorVersion,
  MqttMessageInput,
} from "./types";

export interface MqttBridgeLogger {
  debug?(message: string): void;
  info?(message: string): void;
  warn?(message: string): void;
  error?(message: string): void;
}

export interface MqttBridgeClient {
  on(
    event: "message",
    listener: (topic: string, payload: Buffer, packet: { retain?: boolean }) => void,
  ): this;
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

const defaultMqttClientFactory: MqttClientFactory = async (brokerUrl, options) =>
  await mqtt.connectAsync(brokerUrl, options);

const toMqttPayload = (message: DiscoveryMessage): string =>
  typeof message.payload === "string" ? message.payload : JSON.stringify(message.payload);

export class HomieHaDiscoveryMqttBridge {
  private readonly discoveryBridge: HomieHaDiscoveryBridge;
  private readonly clientFactory: MqttClientFactory;
  private client: MqttBridgeClient | null = null;
  private messageQueue: Promise<void> = Promise.resolve();

  public constructor(private readonly options: HomieHaDiscoveryMqttBridgeOptions) {
    this.discoveryBridge = new HomieHaDiscoveryBridge(options);
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
      const input = {
        topic,
        payload,
        retain: packet.retain === true,
      };
      this.messageQueue = this.messageQueue
        .then(() => this.handleMessage(input))
        .catch((error: unknown) => {
          this.options.logger?.error?.(
            `Failed to process MQTT message '${topic}': ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        });
    });

    const subscriptions = buildHomieMqttSubscriptions({
      homieDomain: this.options.homieDomain,
      legacyRoot: this.options.legacyRoot,
      enabledVersions: this.options.enabledVersions,
      includeAttributeDiagnostics: this.options.includeAttributeDiagnostics,
      qos: this.options.subscriptionQos ?? 1,
    });
    await client.subscribeAsync(subscriptions);
    this.options.logger?.info?.(
      `Subscribed to ${Object.keys(subscriptions).length} Homie MQTT topic pattern(s).`,
    );
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

  /** Wait until all MQTT messages received so far have been processed. */
  public async flush(): Promise<void> {
    await this.messageQueue;
  }

  private async handleMessage(input: MqttMessageInput): Promise<void> {
    const client = this.client;
    if (!client) {
      return;
    }

    const result = this.discoveryBridge.ingest(input);
    for (const warning of result.warnings) {
      this.options.logger?.warn?.(warning);
    }
    for (const log of result.logs) {
      this.options.logger?.info?.(log);
    }

    for (const message of result.messages) {
      await client.publishAsync(message.topic, toMqttPayload(message), {
        qos: message.qos,
        retain: message.retain,
      });
      this.options.logger?.debug?.(`Published discovery message to '${message.topic}'.`);
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
