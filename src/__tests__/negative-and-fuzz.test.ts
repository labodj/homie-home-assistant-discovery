import { HomieHaDiscoveryBridge } from "../HomieHaDiscoveryBridge";
import type { DiscoveryMessage } from "../types";

type DeviceDiscoveryPayload = {
  components: Record<string, Record<string, unknown>>;
};

const publish = (
  bridge: HomieHaDiscoveryBridge,
  messages: ReadonlyArray<readonly [string, string]>,
): DiscoveryMessage[] =>
  messages.flatMap(([topic, payload]) => bridge.ingest({ topic, payload, retain: true }).messages);

const getLatestDevicePayload = (
  messages: DiscoveryMessage[],
  objectId: string,
): DeviceDiscoveryPayload => {
  const topic = `homeassistant/device/${objectId}/config`;
  const message = messages.filter((entry) => entry.topic === topic && entry.payload !== "").at(-1);
  if (!message || message.payload === "") {
    throw new Error(`Expected non-empty discovery payload for '${topic}'.`);
  }
  return message.payload as DeviceDiscoveryPayload;
};

const expectCleanupMessages = (messages: DiscoveryMessage[], deviceObjectId: string): void => {
  expect(messages).toEqual([
    expect.objectContaining({
      topic: `homeassistant/device/${deviceObjectId}/config`,
      payload: "",
      retain: true,
    }),
    expect.objectContaining({
      topic: `homeassistant/sensor/${deviceObjectId}_homie_state/config`,
      payload: "",
      retain: true,
    }),
  ]);
};

describe("negative Homie discovery scenarios", () => {
  it("ignores malformed Homie v5 descriptions without publishing stale discovery", () => {
    const bridge = new HomieHaDiscoveryBridge();

    for (const [payload, warning] of [
      ["{", "not valid JSON"],
      [JSON.stringify([]), "payload is not an object"],
      [JSON.stringify({ homie: "5.0.0", version: 1, nodes: {} }), "not supported"],
    ] as const) {
      const result = bridge.ingest({
        topic: "homie/5/bad-v5/$description",
        payload,
        retain: true,
      });

      expect(result.messages).toEqual([]);
      expect(result.warnings).toEqual([expect.stringContaining(warning)]);
    }
  });

  it("keeps valid Homie v5 siblings while warning about invalid nodes and properties", () => {
    const bridge = new HomieHaDiscoveryBridge();
    const messages = publish(bridge, [
      [
        "homie/5/partial-v5/$description",
        JSON.stringify({
          homie: "5.0",
          version: 1,
          nodes: {
            ValidNode: {
              properties: {
                state: { datatype: "boolean" },
              },
            },
            valid: {
              properties: {
                ok: { datatype: "float", unit: "°C" },
                bad_id: { datatype: "boolean" },
                missing: {},
                malformed: true,
              },
            },
          },
        }),
      ],
    ]);
    const payload = getLatestDevicePayload(messages, "homie_homie_5_partial_v5");

    expect(payload.components).toEqual(
      expect.objectContaining({
        homie_homie_5_partial_v5_valid_ok: expect.objectContaining({
          state_topic: "homie/5/partial-v5/valid/ok",
        }),
      }),
    );

    const result = bridge.ingest({
      topic: "homie/5/partial-v5/$description",
      payload: JSON.stringify({
        homie: "5.0",
        version: 2,
        nodes: {
          valid: {
            properties: {
              ok: { datatype: "float", unit: "°C" },
            },
          },
        },
      }),
    });
    expect(result.warnings).toEqual([]);
  });

  it("waits for required Homie v4 datatype metadata before publishing", () => {
    const bridge = new HomieHaDiscoveryBridge();
    const partialMessages = publish(bridge, [
      ["homie/partial-v4/$homie", "4.0.0"],
      ["homie/partial-v4/$nodes", "sensor"],
      ["homie/partial-v4/sensor/$properties", "temperature"],
      ["homie/partial-v4/sensor/temperature/$unit", "°C"],
    ]);

    expect(partialMessages).toEqual([]);

    const completeMessages = publish(bridge, [
      ["homie/partial-v4/sensor/temperature/$datatype", "float"],
    ]);
    expect(
      getLatestDevicePayload(completeMessages, "homie_homie_partial_v4").components,
    ).toHaveProperty("homie_homie_partial_v4_sensor_temperature");
  });

  it("cleans discovery when a Homie v3 array range is retained-deleted", () => {
    const bridge = new HomieHaDiscoveryBridge();
    publish(bridge, [
      ["homie/array-v3/$homie", "3.0.1"],
      ["homie/array-v3/$nodes", "relay[]"],
      ["homie/array-v3/relay/$array", "1-2"],
      ["homie/array-v3/relay/$properties", "state"],
      ["homie/array-v3/relay/state/$datatype", "boolean"],
    ]);

    const messages = publish(bridge, [["homie/array-v3/relay/$array", ""]]);

    expectCleanupMessages(messages, "homie_homie_array_v3");
  });

  it("does not publish legacy array nodes with invalid ranges", () => {
    const bridge = new HomieHaDiscoveryBridge();
    const result = bridge.ingest({
      topic: "homie/bad-array/relay/$array",
      payload: "2-1",
      retain: true,
    });

    expect(result.messages).toEqual([]);
    expect(result.warnings).toEqual([
      "Ignored invalid legacy Homie array range '2-1' for 'bad-array/relay'.",
    ]);
  });

  it("is idempotent for duplicate retained legacy metadata replays", () => {
    const bridge = new HomieHaDiscoveryBridge();
    const retainedReplay = [
      ["homie/dupe/$homie", "4.0.0"],
      ["homie/dupe/$nodes", "sensor"],
      ["homie/dupe/sensor/$properties", "temperature"],
      ["homie/dupe/sensor/temperature/$datatype", "float"],
    ] as const;

    expect(publish(bridge, retainedReplay)).toHaveLength(2);
    expect(publish(bridge, retainedReplay)).toEqual([]);
  });
});

describe("deterministic Homie topic and metadata fuzz tests", () => {
  const validIds = ["a", "sensor", "sensor-1", "kitchen-light", "x1-y2-z3", "device-999"] as const;

  it("never throws and produces stable ids for generated valid Homie v5 descriptions", () => {
    for (let index = 0; index < 120; index += 1) {
      const deviceId = validIds[index % validIds.length];
      const nodeId = validIds[(index + 1) % validIds.length];
      const propertyId = validIds[(index + 2) % validIds.length];
      const datatype = index % 2 === 0 ? "boolean" : "float";
      const bridge = new HomieHaDiscoveryBridge({ idPrefix: `case-${index}` });

      const result = bridge.ingest({
        topic: `homie/5/${deviceId}/$description`,
        payload: JSON.stringify({
          homie: `5.${index % 6}`,
          version: index,
          nodes: {
            [nodeId]: {
              properties: {
                [propertyId]: {
                  datatype,
                  settable: datatype === "boolean" && index % 3 === 0,
                  unit: datatype === "float" ? "V" : undefined,
                },
              },
            },
          },
          [`x-future-${index}`]: { ignored: true },
        }),
        retain: true,
      });

      expect(result.warnings).toEqual([]);
      expect(result.messages).toHaveLength(2);
      expect(result.messages[0]?.topic).toMatch(/^homeassistant\/device\/case_\d+_homie_5_/);
    }
  });

  it("never throws on malformed topic shapes or invalid identifiers", () => {
    const bridge = new HomieHaDiscoveryBridge();
    const malformedTopics = [
      "",
      "/homie/5/device/$description",
      "homie//device/$homie",
      "homie/5/Device/$description",
      "homie/5/device_1/$description",
      "homie/6/device/$description",
      "homie/device/node/bad_property/$datatype",
      "homie/$broadcast/alert",
      "other/root/topic",
    ];

    for (const topic of malformedTopics) {
      expect(() =>
        bridge.ingest({
          topic,
          payload: JSON.stringify({ homie: "5.0", version: 1, nodes: {} }),
        }),
      ).not.toThrow();
    }
  });
});
