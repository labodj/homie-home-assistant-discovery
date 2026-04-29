import { HomieHaDiscoveryMqttBridge } from "../mqtt-adapter";
import { buildHomieMqttSubscriptions } from "../subscriptions";
import type { MqttBridgeClient } from "../mqtt-adapter";
import type { MqttQoS } from "../subscriptions";

class FakeMqttClient implements MqttBridgeClient {
  public subscriptions: Record<string, { qos: MqttQoS }> | null = null;
  public published: Array<{
    topic: string;
    payload: string | Buffer;
    options: { qos: MqttQoS; retain: boolean };
  }> = [];
  public ended = false;
  public failNextPublish = false;
  public subscribeCalls = 0;
  private readonly messageListeners: Array<
    (topic: string, payload: Buffer, packet: { retain?: boolean }) => void
  > = [];

  public on(
    event: "message",
    listener: (topic: string, payload: Buffer, packet: { retain?: boolean }) => void,
  ): this {
    if (event === "message") {
      this.messageListeners.push(listener);
    }
    return this;
  }

  public subscribeAsync(subscriptions: Record<string, { qos: MqttQoS }>): Promise<void> {
    this.subscribeCalls += 1;
    this.subscriptions = subscriptions;
    return Promise.resolve();
  }

  public publishAsync(
    topic: string,
    payload: string | Buffer,
    options: { qos: MqttQoS; retain: boolean },
  ): Promise<void> {
    if (this.failNextPublish) {
      this.failNextPublish = false;
      return Promise.reject(new Error("publish failed"));
    }
    this.published.push({ topic, payload, options });
    return Promise.resolve();
  }

  public endAsync(): Promise<void> {
    this.ended = true;
    return Promise.resolve();
  }

  public emitMessage(topic: string, payload: string, packet: { retain?: boolean } = {}): void {
    for (const listener of this.messageListeners) {
      listener(topic, Buffer.from(payload), packet);
    }
  }
}

const buildDescription = (): string =>
  JSON.stringify({
    homie: "5.0",
    version: 1,
    name: "Kitchen Controller",
    nodes: {
      relay: {
        name: "Relay",
        properties: {
          state: {
            datatype: "boolean",
            settable: true,
          },
        },
      },
    },
  });

describe("mqtt adapter", () => {
  it("builds the MQTT subscription map for enabled Homie versions", () => {
    expect(
      buildHomieMqttSubscriptions({
        homieDomain: "building/homie",
        legacyRoot: "legacy/homie",
        enabledVersions: [5],
      }),
    ).toEqual({
      "building/homie/5/+/#": { qos: 1 },
    });
    expect(
      buildHomieMqttSubscriptions({
        homieDomain: "building/homie",
        enabledVersions: [5],
        includeAttributeDiagnostics: false,
      }),
    ).toEqual({
      "building/homie/5/+/$description": { qos: 1 },
      "building/homie/5/+/$state": { qos: 1 },
    });
  });

  it("subscribes and republishes generated Home Assistant discovery messages", async () => {
    const fakeClient = new FakeMqttClient();
    const bridge = new HomieHaDiscoveryMqttBridge({
      brokerUrl: "mqtt://example.invalid",
      clientFactory: () => Promise.resolve(fakeClient),
    });

    await bridge.start();
    fakeClient.emitMessage("homie/5/kitchen/$description", buildDescription(), { retain: true });
    await bridge.flush();

    expect(fakeClient.subscriptions).toEqual({
      "homie/#": { qos: 1 },
    });
    expect(fakeClient.published).toEqual([
      expect.objectContaining({
        topic: "homeassistant/device/homie_homie_5_kitchen/config",
        options: { qos: 1, retain: true },
      }),
      expect.objectContaining({
        topic: "homeassistant/sensor/homie_homie_5_kitchen_homie_state/config",
        options: { qos: 1, retain: true },
      }),
    ]);

    await bridge.stop();
    expect(fakeClient.ended).toBe(true);
  });

  it("is safe to start and stop idempotently", async () => {
    const fakeClient = new FakeMqttClient();
    let factoryCalls = 0;
    const bridge = new HomieHaDiscoveryMqttBridge({
      brokerUrl: "mqtt://example.invalid",
      subscriptionQos: 2,
      enabledVersions: [5],
      clientFactory: () => {
        factoryCalls += 1;
        return Promise.resolve(fakeClient);
      },
    });

    await bridge.stop();
    await bridge.start();
    await bridge.start();
    await bridge.stop();
    await bridge.stop();

    expect(factoryCalls).toBe(1);
    expect(fakeClient.subscribeCalls).toBe(1);
    expect(fakeClient.subscriptions).toEqual({
      "homie/5/+/#": { qos: 2 },
    });
    expect(fakeClient.ended).toBe(true);
  });

  it("emits parser warnings, generation logs and publish debug logs through the logger", async () => {
    const fakeClient = new FakeMqttClient();
    const warnings: string[] = [];
    const infos: string[] = [];
    const debugs: string[] = [];
    const bridge = new HomieHaDiscoveryMqttBridge({
      brokerUrl: "mqtt://example.invalid",
      clientFactory: () => Promise.resolve(fakeClient),
      logger: {
        warn: (message) => warnings.push(message),
        info: (message) => infos.push(message),
        debug: (message) => debugs.push(message),
      },
    });

    await bridge.start();
    fakeClient.emitMessage("other/topic", "ignored");
    fakeClient.emitMessage("homie/5/kitchen/$description", buildDescription(), { retain: true });
    await bridge.flush();

    expect(warnings).toEqual(["Ignored non-Homie topic 'other/topic'."]);
    expect(infos).toEqual(
      expect.arrayContaining([
        "Subscribed to 1 Homie MQTT topic pattern(s).",
        "Generated Home Assistant discovery for 'kitchen'.",
      ]),
    );
    expect(debugs).toEqual([
      "Published discovery message to 'homeassistant/device/homie_homie_5_kitchen/config'.",
      "Published discovery message to 'homeassistant/sensor/homie_homie_5_kitchen_homie_state/config'.",
    ]);

    await bridge.stop();
  });

  it("logs publish failures and continues processing later MQTT messages", async () => {
    const fakeClient = new FakeMqttClient();
    const errors: string[] = [];
    const bridge = new HomieHaDiscoveryMqttBridge({
      brokerUrl: "mqtt://example.invalid",
      clientFactory: () => Promise.resolve(fakeClient),
      logger: {
        error: (message) => errors.push(message),
      },
    });

    await bridge.start();
    fakeClient.failNextPublish = true;
    fakeClient.emitMessage("homie/5/kitchen/$description", buildDescription(), { retain: true });
    await bridge.flush();

    fakeClient.emitMessage(
      "homie/5/living-room/$description",
      JSON.stringify({
        homie: "5.0",
        version: 1,
        nodes: {
          relay: {
            properties: {
              state: {
                datatype: "boolean",
                settable: true,
              },
            },
          },
        },
      }),
      { retain: true },
    );
    await bridge.flush();

    expect(errors).toEqual([
      "Failed to process MQTT message 'homie/5/kitchen/$description': publish failed",
    ]);
    expect(fakeClient.published).toEqual([
      expect.objectContaining({
        topic: "homeassistant/device/homie_homie_5_living_room/config",
      }),
      expect.objectContaining({
        topic: "homeassistant/sensor/homie_homie_5_living_room_homie_state/config",
      }),
    ]);

    await bridge.stop();
  });
});
