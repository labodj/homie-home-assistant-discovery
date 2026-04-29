import { HomieHaDiscoveryBridge } from "../HomieHaDiscoveryBridge";
import type { DiscoveryMessage, HomieHaDiscoveryOptions } from "../types";

type DeviceDiscoveryPayload = {
  components: Record<string, Record<string, unknown>>;
};

const testOptions: HomieHaDiscoveryOptions = {
  discoveryPrefix: "homeassistant",
  homieDomain: "homie-ha-test",
  legacyRoot: "homie-ha-test",
  idPrefix: "homie_ha_test",
  overrides: {
    rules: [
      {
        match: { path: "lights/*", datatype: "boolean", settable: true },
        platform: "light",
      },
      {
        match: { nodeId: "fan", propertyId: "state", datatype: "boolean", settable: true },
        platform: "fan",
      },
    ],
    devices: {
      "homie-ha-test/5/kitchen": {
        properties: {
          "relay/state": {
            platform: "light",
            name: "Kitchen Ceiling",
            icon: "mdi:ceiling-light",
          },
        },
      },
    },
  },
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

describe("soak discovery fixtures", () => {
  it("maps a mixed Homie v5 device with rules, exact overrides and fallback booleans", () => {
    const bridge = new HomieHaDiscoveryBridge(testOptions);
    const messages = publish(bridge, [
      [
        "homie-ha-test/5/kitchen/$description",
        JSON.stringify({
          homie: "5.0",
          version: 1,
          name: "Kitchen",
          nodes: {
            lights: {
              properties: {
                state: { datatype: "boolean", settable: true, retained: true },
              },
            },
            fan: {
              properties: {
                state: { datatype: "boolean", settable: true, retained: true },
              },
            },
            relay: {
              properties: {
                state: { datatype: "boolean", settable: true, retained: true },
              },
            },
            outlet: {
              properties: {
                state: { datatype: "boolean", settable: true, retained: true },
              },
            },
            environment: {
              properties: {
                temperature: { datatype: "float", unit: "°C", retained: true },
                metadata: { datatype: "json", retained: true },
                mode: {
                  datatype: "enum",
                  format: "auto,manual,,boost,off",
                  settable: true,
                  retained: true,
                },
              },
            },
            controls: {
              properties: {
                color: { datatype: "color", settable: true },
                timeout: { datatype: "duration", settable: true },
                wakeup: { datatype: "datetime", settable: true },
              },
            },
          },
          futureField: { ignored: true },
        }),
      ],
    ]);
    const payload = getLatestDevicePayload(messages, "homie_ha_test_homie_ha_test_5_kitchen");

    expect(payload.components).toEqual(
      expect.objectContaining({
        homie_ha_test_homie_ha_test_5_kitchen_lights_state: expect.objectContaining({
          platform: "light",
        }),
        homie_ha_test_homie_ha_test_5_kitchen_fan_state: expect.objectContaining({
          platform: "fan",
        }),
        homie_ha_test_homie_ha_test_5_kitchen_relay_state: expect.objectContaining({
          platform: "light",
          name: "Kitchen Ceiling",
          icon: "mdi:ceiling-light",
        }),
        homie_ha_test_homie_ha_test_5_kitchen_outlet_state: expect.objectContaining({
          platform: "switch",
        }),
        homie_ha_test_homie_ha_test_5_kitchen_environment_temperature: expect.objectContaining({
          platform: "sensor",
          device_class: "temperature",
          unit_of_measurement: "°C",
        }),
        homie_ha_test_homie_ha_test_5_kitchen_environment_metadata: expect.objectContaining({
          platform: "sensor",
          value_template: "{{ 'json' }}",
          json_attributes_topic: "homie-ha-test/5/kitchen/environment/metadata",
        }),
        homie_ha_test_homie_ha_test_5_kitchen_environment_mode: expect.objectContaining({
          platform: "select",
          options: ["auto", "manual,boost", "off"],
        }),
        homie_ha_test_homie_ha_test_5_kitchen_controls_color: expect.objectContaining({
          platform: "text",
        }),
        homie_ha_test_homie_ha_test_5_kitchen_controls_timeout: expect.objectContaining({
          platform: "text",
        }),
        homie_ha_test_homie_ha_test_5_kitchen_controls_wakeup: expect.objectContaining({
          platform: "text",
        }),
      }),
    );
  });

  it("maps Homie v4 retained metadata arriving in production-like shuffled order", () => {
    const bridge = new HomieHaDiscoveryBridge(testOptions);
    const messages = publish(bridge, [
      ["homie-ha-test/kitchen-v4/environment/temperature/$unit", "°C"],
      ["homie-ha-test/kitchen-v4/lights/state/$settable", "true"],
      ["homie-ha-test/kitchen-v4/fan/state/$datatype", "boolean"],
      ["homie-ha-test/kitchen-v4/relay/state/$settable", "true"],
      ["homie-ha-test/kitchen-v4/outlet/state/$datatype", "boolean"],
      ["homie-ha-test/kitchen-v4/lights/state/$datatype", "boolean"],
      ["homie-ha-test/kitchen-v4/environment/temperature/$datatype", "float"],
      ["homie-ha-test/kitchen-v4/fan/state/$settable", "true"],
      ["homie-ha-test/kitchen-v4/outlet/state/$settable", "true"],
      ["homie-ha-test/kitchen-v4/relay/state/$datatype", "boolean"],
      ["homie-ha-test/kitchen-v4/lights/$properties", "state"],
      ["homie-ha-test/kitchen-v4/fan/$properties", "state"],
      ["homie-ha-test/kitchen-v4/relay/$properties", "state"],
      ["homie-ha-test/kitchen-v4/outlet/$properties", "state"],
      ["homie-ha-test/kitchen-v4/environment/$properties", "temperature"],
      ["homie-ha-test/kitchen-v4/$nodes", "lights,fan,relay,outlet,environment"],
      ["homie-ha-test/kitchen-v4/$name", "Kitchen v4"],
      ["homie-ha-test/kitchen-v4/$homie", "4.0.0"],
    ]);
    const payload = getLatestDevicePayload(messages, "homie_ha_test_homie_ha_test_kitchen_v4");

    expect(payload.components).toEqual(
      expect.objectContaining({
        homie_ha_test_homie_ha_test_kitchen_v4_lights_state: expect.objectContaining({
          platform: "light",
        }),
        homie_ha_test_homie_ha_test_kitchen_v4_fan_state: expect.objectContaining({
          platform: "fan",
        }),
        homie_ha_test_homie_ha_test_kitchen_v4_relay_state: expect.objectContaining({
          platform: "switch",
        }),
        homie_ha_test_homie_ha_test_kitchen_v4_outlet_state: expect.objectContaining({
          platform: "switch",
        }),
        homie_ha_test_homie_ha_test_kitchen_v4_environment_temperature: expect.objectContaining({
          platform: "sensor",
          device_class: "temperature",
        }),
      }),
    );
  });

  it("applies mapping rules to Homie v3 array nodes using the base array node id", () => {
    const bridge = new HomieHaDiscoveryBridge(testOptions);
    const messages = publish(bridge, [
      ["homie-ha-test/garage-v3/$homie", "3.0.1"],
      ["homie-ha-test/garage-v3/$nodes", "lights[],fan[],doors[]"],
      ["homie-ha-test/garage-v3/lights/$array", "0-1"],
      ["homie-ha-test/garage-v3/lights/$properties", "state"],
      ["homie-ha-test/garage-v3/lights/state/$datatype", "boolean"],
      ["homie-ha-test/garage-v3/lights/state/$settable", "true"],
      ["homie-ha-test/garage-v3/fan/$array", "1-2"],
      ["homie-ha-test/garage-v3/fan/$properties", "state"],
      ["homie-ha-test/garage-v3/fan/state/$datatype", "boolean"],
      ["homie-ha-test/garage-v3/fan/state/$settable", "true"],
      ["homie-ha-test/garage-v3/doors/$array", "1-1"],
      ["homie-ha-test/garage-v3/doors/$properties", "open"],
      ["homie-ha-test/garage-v3/doors/open/$datatype", "boolean"],
    ]);
    const payload = getLatestDevicePayload(messages, "homie_ha_test_homie_ha_test_garage_v3");

    expect(payload.components).toEqual(
      expect.objectContaining({
        homie_ha_test_homie_ha_test_garage_v3_lights_0_state: expect.objectContaining({
          platform: "light",
        }),
        homie_ha_test_homie_ha_test_garage_v3_lights_1_state: expect.objectContaining({
          platform: "light",
        }),
        homie_ha_test_homie_ha_test_garage_v3_fan_1_state: expect.objectContaining({
          platform: "fan",
        }),
        homie_ha_test_homie_ha_test_garage_v3_fan_2_state: expect.objectContaining({
          platform: "fan",
        }),
        homie_ha_test_homie_ha_test_garage_v3_doors_1_open: expect.objectContaining({
          platform: "binary_sensor",
        }),
      }),
    );
  });
});
