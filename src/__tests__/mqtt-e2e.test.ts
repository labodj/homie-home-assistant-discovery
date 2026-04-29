import { createServer, type Server } from "node:net";

import mqtt from "mqtt";
import { createBroker } from "aedes";
import type { MqttClient } from "mqtt";

import { HomieHaDiscoveryMqttBridge } from "../mqtt-adapter";

interface TestBroker {
  brokerUrl: string;
  close: () => Promise<void>;
}

interface CapturedMessage {
  topic: string;
  payload: string;
  retain: boolean;
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

const closeServer = async (server: Server): Promise<void> =>
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

const startTestBroker = async (): Promise<TestBroker> => {
  const aedes = createBroker();
  const server = createServer(aedes.handle);

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to allocate MQTT test broker port.");
  }

  return {
    brokerUrl: `mqtt://127.0.0.1:${address.port}`,
    close: async () => {
      await closeServer(server);
      await new Promise<void>((resolve) => {
        aedes.close(resolve);
      });
    },
  };
};

const connectClient = async (brokerUrl: string, clientId: string): Promise<MqttClient> =>
  await mqtt.connectAsync(brokerUrl, {
    clean: true,
    clientId,
    reconnectPeriod: 0,
  });

const waitForMessage = async (
  messages: CapturedMessage[],
  predicate: (message: CapturedMessage) => boolean,
  timeoutMs = 3000,
): Promise<CapturedMessage> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const message = messages.find(predicate);
    if (message) {
      return message;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error("Timed out waiting for MQTT message.");
};

describe("MQTT end-to-end bridge", () => {
  it("processes retained Homie replay and publishes retained HA discovery and cleanup", async () => {
    const broker = await startTestBroker();
    const publisher = await connectClient(broker.brokerUrl, "homie-ha-test-publisher");
    const observer = await connectClient(broker.brokerUrl, "homie-ha-test-observer");
    const observedMessages: CapturedMessage[] = [];

    observer.on("message", (topic, payload, packet) => {
      observedMessages.push({
        topic,
        payload: payload.toString(),
        retain: packet.retain,
      });
    });
    await observer.subscribeAsync("homeassistant/#", { qos: 1 });

    await publisher.publishAsync("homie/5/kitchen/$description", buildDescription(), {
      qos: 1,
      retain: true,
    });

    const bridge = new HomieHaDiscoveryMqttBridge({
      brokerUrl: broker.brokerUrl,
      enabledVersions: [5],
      mqttOptions: {
        clientId: "homie-ha-test-bridge",
        clean: true,
        reconnectPeriod: 0,
      },
    });

    try {
      await bridge.start();
      const discoveryMessage = await waitForMessage(
        observedMessages,
        (message) => message.topic === "homeassistant/device/homie_homie_5_kitchen/config",
      );
      const discoveryPayload = JSON.parse(discoveryMessage.payload) as {
        components?: Record<string, unknown>;
      };

      expect(discoveryPayload.components).toEqual(
        expect.objectContaining({
          homie_homie_5_kitchen_relay_state: expect.objectContaining({
            platform: "switch",
            state_topic: "homie/5/kitchen/relay/state",
            command_topic: "homie/5/kitchen/relay/state/set",
          }),
        }),
      );

      const retainedClient = await connectClient(broker.brokerUrl, "homie-ha-test-retained");
      const retainedMessages: CapturedMessage[] = [];
      retainedClient.on("message", (topic, payload, packet) => {
        retainedMessages.push({
          topic,
          payload: payload.toString(),
          retain: packet.retain,
        });
      });
      await retainedClient.subscribeAsync("homeassistant/device/homie_homie_5_kitchen/config", {
        qos: 1,
      });

      const retainedDiscovery = await waitForMessage(
        retainedMessages,
        (message) => message.topic === "homeassistant/device/homie_homie_5_kitchen/config",
      );
      expect(retainedDiscovery.retain).toBe(true);
      await retainedClient.endAsync();

      observedMessages.length = 0;
      await publisher.publishAsync("homie/5/kitchen/$state", "", {
        qos: 1,
        retain: true,
      });

      await waitForMessage(
        observedMessages,
        (message) =>
          message.topic === "homeassistant/device/homie_homie_5_kitchen/config" &&
          message.payload === "",
      );
      await waitForMessage(
        observedMessages,
        (message) =>
          message.topic === "homeassistant/sensor/homie_homie_5_kitchen_homie_state/config" &&
          message.payload === "",
      );
    } finally {
      await bridge.stop();
      await observer.endAsync();
      await publisher.endAsync();
      await broker.close();
    }
  });
});
