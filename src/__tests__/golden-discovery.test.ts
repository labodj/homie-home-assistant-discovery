import { HomieHaDiscoveryBridge } from "../HomieHaDiscoveryBridge";
import type { DiscoveryMessage } from "../types";

type DeviceDiscoveryPayload = {
  device: Record<string, unknown>;
  components: Record<string, Record<string, unknown>>;
};

const publish = (
  bridge: HomieHaDiscoveryBridge,
  messages: ReadonlyArray<readonly [string, string]>,
): DiscoveryMessage[] =>
  messages.flatMap(([topic, payload]) => bridge.ingest({ topic, payload, retain: true }).messages);

const getLatestDevicePayload = (
  messages: DiscoveryMessage[],
  topic = "homeassistant/device/homie_homie_5_supercar/config",
): DeviceDiscoveryPayload => {
  const message = messages.filter((entry) => entry.topic === topic && entry.payload !== "").at(-1);
  if (!message || message.payload === "") {
    throw new Error(`Expected non-empty discovery payload for '${topic}'.`);
  }
  return message.payload as DeviceDiscoveryPayload;
};

const getDevicePayloads = (
  messages: DiscoveryMessage[],
  topic = "homeassistant/device/homie_homie_5_supercar/config",
): DeviceDiscoveryPayload[] =>
  messages
    .filter((entry) => entry.topic === topic && entry.payload !== "")
    .map((entry) => entry.payload as DeviceDiscoveryPayload);

const expectCleanupMessages = (messages: DiscoveryMessage[], deviceObjectId: string): void => {
  expect(messages).toEqual([
    {
      topic: `homeassistant/device/${deviceObjectId}/config`,
      payload: "",
      qos: 1,
      retain: true,
    },
    {
      topic: `homeassistant/sensor/${deviceObjectId}_homie_state/config`,
      payload: "",
      qos: 1,
      retain: true,
    },
  ]);
};

const buildHomieV5SupercarDescription = (): string =>
  JSON.stringify({
    homie: "5.0",
    name: "Supercar",
    type: "vehicle",
    version: 7,
    nodes: {
      engine: {
        name: "Engine",
        properties: {
          temperature: {
            name: "Temperature",
            datatype: "float",
            unit: "°C",
            format: "-20:120",
            retained: true,
          },
          speed: {
            name: "Speed",
            datatype: "integer",
            unit: "rpm",
            format: "0:8000",
            retained: true,
          },
        },
      },
      lights: {
        name: "Lights",
        properties: {
          power: {
            name: "Power",
            datatype: "boolean",
            format: "off,on",
            settable: true,
            retained: true,
          },
          mode: {
            name: "Mode",
            datatype: "enum",
            format: "auto,manual,off",
            settable: true,
            retained: true,
          },
        },
      },
      service: {
        name: "Service",
        properties: {
          metadata: {
            name: "Metadata",
            datatype: "json",
            retained: true,
          },
        },
      },
    },
  });

describe("golden Homie discovery fixtures", () => {
  it("maps a Homie v5 description fixture to stable Home Assistant components", () => {
    const bridge = new HomieHaDiscoveryBridge();
    const messages = publish(bridge, [
      ["homie/5/supercar/$description", buildHomieV5SupercarDescription()],
    ]);
    const payload = getLatestDevicePayload(messages);

    expect(payload.device).toEqual(
      expect.objectContaining({
        name: "Supercar",
        manufacturer: "Homie",
        model: "vehicle",
      }),
    );
    expect(payload.components).toEqual(
      expect.objectContaining({
        homie_homie_5_supercar_engine_speed: expect.objectContaining({
          platform: "sensor",
          name: "Engine Speed",
          state_topic: "homie/5/supercar/engine/speed",
          unit_of_measurement: "rpm",
          state_class: "measurement",
        }),
        homie_homie_5_supercar_engine_temperature: expect.objectContaining({
          platform: "sensor",
          name: "Engine Temperature",
          state_topic: "homie/5/supercar/engine/temperature",
          unit_of_measurement: "°C",
          state_class: "measurement",
        }),
        homie_homie_5_supercar_lights_power: expect.objectContaining({
          platform: "light",
          name: "Lights Power",
          state_topic: "homie/5/supercar/lights/power",
          command_topic: "homie/5/supercar/lights/power/set",
          payload_on: "on",
          payload_off: "off",
        }),
        homie_homie_5_supercar_lights_mode: expect.objectContaining({
          platform: "select",
          name: "Lights Mode",
          command_topic: "homie/5/supercar/lights/mode/set",
          options: ["auto", "manual", "off"],
        }),
        homie_homie_5_supercar_service_metadata: expect.objectContaining({
          platform: "sensor",
          name: "Service Metadata",
          state_topic: "homie/5/supercar/service/metadata",
          value_template: "{{ 'json' }}",
          json_attributes_topic: "homie/5/supercar/service/metadata",
        }),
      }),
    );
  });

  it("maps settable Homie v5 datatypes to commandable Home Assistant entities", () => {
    const bridge = new HomieHaDiscoveryBridge();
    const messages = publish(bridge, [
      [
        "homie/5/panel/$description",
        JSON.stringify({
          homie: "5.0",
          version: 1,
          name: "Panel",
          nodes: {
            controls: {
              name: "Controls",
              properties: {
                brightness: {
                  datatype: "integer",
                  format: "0:100:5",
                  settable: true,
                },
                color: {
                  datatype: "color",
                  format: "rgb,hsv",
                  settable: true,
                },
                scene: {
                  datatype: "enum",
                  settable: true,
                },
                schedule: {
                  datatype: "json",
                  settable: true,
                },
                wakeup: {
                  datatype: "datetime",
                  settable: true,
                },
                timeout: {
                  datatype: "duration",
                  settable: true,
                },
              },
            },
          },
        }),
      ],
    ]);
    const payload = getLatestDevicePayload(
      messages,
      "homeassistant/device/homie_homie_5_panel/config",
    );

    expect(payload.components).toEqual(
      expect.objectContaining({
        homie_homie_5_panel_controls_brightness: expect.objectContaining({
          platform: "number",
          command_topic: "homie/5/panel/controls/brightness/set",
          min: 0,
          max: 100,
          step: 5,
        }),
        homie_homie_5_panel_controls_color: expect.objectContaining({
          platform: "text",
          command_topic: "homie/5/panel/controls/color/set",
        }),
        homie_homie_5_panel_controls_scene: expect.objectContaining({
          platform: "text",
          command_topic: "homie/5/panel/controls/scene/set",
        }),
        homie_homie_5_panel_controls_schedule: expect.objectContaining({
          platform: "text",
          command_topic: "homie/5/panel/controls/schedule/set",
        }),
        homie_homie_5_panel_controls_wakeup: expect.objectContaining({
          platform: "text",
          command_topic: "homie/5/panel/controls/wakeup/set",
        }),
        homie_homie_5_panel_controls_timeout: expect.objectContaining({
          platform: "text",
          command_topic: "homie/5/panel/controls/timeout/set",
        }),
      }),
    );
  });

  it("applies granular ordered mapping rules before exact property overrides", () => {
    const bridge = new HomieHaDiscoveryBridge({
      overrides: {
        rules: [
          {
            match: { datatype: "boolean", settable: true },
            platform: "switch",
          },
          {
            match: { path: "lights/state" },
            platform: "light",
            name: "Rule Light",
          },
          {
            match: { nodeId: "fan", propertyId: "state" },
            platform: "fan",
          },
          {
            match: { path: "pump/state" },
            platform: "fan",
          },
        ],
        devices: {
          "homie/5/mixed": {
            properties: {
              "pump/state": {
                platform: "light",
                name: "Exact Pump",
              },
            },
          },
        },
      },
    });
    const messages = publish(bridge, [
      [
        "homie/5/mixed/$description",
        JSON.stringify({
          homie: "5.0",
          version: 1,
          name: "Mixed",
          nodes: {
            lights: {
              properties: {
                state: { datatype: "boolean", settable: true },
              },
            },
            fan: {
              properties: {
                state: { datatype: "boolean", settable: true },
              },
            },
            pump: {
              properties: {
                state: { datatype: "boolean", settable: true },
              },
            },
            relay: {
              properties: {
                state: { datatype: "boolean", settable: true },
              },
            },
          },
        }),
      ],
    ]);
    const payload = getLatestDevicePayload(
      messages,
      "homeassistant/device/homie_homie_5_mixed/config",
    );

    expect(payload.components).toEqual(
      expect.objectContaining({
        homie_homie_5_mixed_lights_state: expect.objectContaining({
          platform: "light",
          name: "Rule Light",
        }),
        homie_homie_5_mixed_fan_state: expect.objectContaining({
          platform: "fan",
        }),
        homie_homie_5_mixed_pump_state: expect.objectContaining({
          platform: "light",
          name: "Exact Pump",
        }),
        homie_homie_5_mixed_relay_state: expect.objectContaining({
          platform: "switch",
        }),
      }),
    );
  });

  it("accepts compatible future Homie v5 minors and maps direct parent device relationships", () => {
    const bridge = new HomieHaDiscoveryBridge();
    const messages = publish(bridge, [
      [
        "homie/5/trailer/$description",
        JSON.stringify({
          homie: "5.1",
          version: 1,
          name: "Trailer",
          root: "garage-hub",
          parent: "tow-controller",
          extensions: ["org.example.future"],
          nodes: {
            hitch: {
              name: "Hitch",
              properties: {
                locked: {
                  datatype: "boolean",
                  retained: false,
                },
              },
            },
          },
        }),
      ],
    ]);
    const payload = getLatestDevicePayload(
      messages,
      "homeassistant/device/homie_homie_5_trailer/config",
    );

    expect(payload.device).toEqual(
      expect.objectContaining({
        name: "Trailer",
        via_device: "homie:tow-controller",
      }),
    );
    expect(payload.components.homie_homie_5_trailer_hitch_locked).toEqual(
      expect.objectContaining({
        platform: "binary_sensor",
        force_update: true,
      }),
    );
  });

  it("infers common Home Assistant sensor device classes from Homie metadata", () => {
    const bridge = new HomieHaDiscoveryBridge();
    const messages = publish(bridge, [
      [
        "homie/5/meteo/$description",
        JSON.stringify({
          homie: "5.0",
          version: 1,
          name: "Meteo",
          nodes: {
            environment: {
              name: "Environment",
              properties: {
                temperature: { datatype: "float", unit: "°C" },
                humidity: { datatype: "integer", unit: "%" },
                battery: { datatype: "integer", unit: "%" },
                voltage: { datatype: "float", unit: "V" },
                current: { datatype: "float", unit: "mA" },
                power: { datatype: "float", unit: "W" },
                energy: { datatype: "float", unit: "kWh" },
                pressure: { datatype: "float", unit: "hPa" },
                illuminance: { datatype: "integer", unit: "lx" },
                signal: { datatype: "integer", unit: "dBm" },
                frequency: { datatype: "float", unit: "Hz" },
              },
            },
          },
        }),
      ],
    ]);
    const payload = getLatestDevicePayload(
      messages,
      "homeassistant/device/homie_homie_5_meteo/config",
    );

    expect(payload.components).toEqual(
      expect.objectContaining({
        homie_homie_5_meteo_environment_temperature: expect.objectContaining({
          device_class: "temperature",
          state_class: "measurement",
          unit_of_measurement: "°C",
        }),
        homie_homie_5_meteo_environment_humidity: expect.objectContaining({
          device_class: "humidity",
          unit_of_measurement: "%",
        }),
        homie_homie_5_meteo_environment_battery: expect.objectContaining({
          device_class: "battery",
          unit_of_measurement: "%",
        }),
        homie_homie_5_meteo_environment_voltage: expect.objectContaining({
          device_class: "voltage",
          unit_of_measurement: "V",
        }),
        homie_homie_5_meteo_environment_current: expect.objectContaining({
          device_class: "current",
          unit_of_measurement: "mA",
        }),
        homie_homie_5_meteo_environment_power: expect.objectContaining({
          device_class: "power",
          unit_of_measurement: "W",
        }),
        homie_homie_5_meteo_environment_energy: expect.objectContaining({
          device_class: "energy",
          unit_of_measurement: "kWh",
        }),
        homie_homie_5_meteo_environment_pressure: expect.objectContaining({
          device_class: "pressure",
          unit_of_measurement: "hPa",
        }),
        homie_homie_5_meteo_environment_illuminance: expect.objectContaining({
          device_class: "illuminance",
          unit_of_measurement: "lx",
        }),
        homie_homie_5_meteo_environment_signal: expect.objectContaining({
          device_class: "signal_strength",
          unit_of_measurement: "dBm",
        }),
        homie_homie_5_meteo_environment_frequency: expect.objectContaining({
          device_class: "frequency",
          unit_of_measurement: "Hz",
        }),
      }),
    );
  });

  it("maps Homie v4 metadata arriving out of order once enough retained state is known", () => {
    const bridge = new HomieHaDiscoveryBridge();
    const messages = publish(bridge, [
      ["homie/weather/sensor/temperature/$unit", "°C"],
      ["homie/weather/sensor/temperature/$datatype", "float"],
      ["homie/weather/sensor/temperature/$name", "Temperature"],
      ["homie/weather/sensor/humidity/$unit", "%"],
      ["homie/weather/sensor/humidity/$datatype", "integer"],
      ["homie/weather/sensor/humidity/$name", "Humidity"],
      ["homie/weather/sensor/$properties", "temperature,humidity"],
      ["homie/weather/sensor/$name", "Outdoor"],
      ["homie/weather/$nodes", "sensor"],
      ["homie/weather/$name", "Weather Station"],
      ["homie/weather/$homie", "4.0.0"],
    ]);
    const payload = getLatestDevicePayload(
      messages,
      "homeassistant/device/homie_homie_weather/config",
    );

    expect(payload.device).toEqual(
      expect.objectContaining({
        name: "Weather Station",
      }),
    );
    expect(payload.components).toEqual(
      expect.objectContaining({
        homie_homie_weather_sensor_temperature: expect.objectContaining({
          platform: "sensor",
          name: "Outdoor Temperature",
          unit_of_measurement: "°C",
          state_topic: "homie/weather/sensor/temperature",
          state_class: "measurement",
        }),
        homie_homie_weather_sensor_humidity: expect.objectContaining({
          platform: "sensor",
          name: "Outdoor Humidity",
          unit_of_measurement: "%",
          state_topic: "homie/weather/sensor/humidity",
          state_class: "measurement",
        }),
      }),
    );
  });

  it("maps legacy Homie firmware and stats extension metadata", () => {
    const bridge = new HomieHaDiscoveryBridge();
    const messages = publish(bridge, [
      ["homie/weather/$homie", "4.0.0"],
      ["homie/weather/$name", "Weather Station"],
      ["homie/weather/$fw/name", "weather-fw"],
      ["homie/weather/$fw/version", "1.2.3"],
      ["homie/weather/$mac", "AA:BB:CC:DD:EE:FF"],
      ["homie/weather/$nodes", "sensor"],
      ["homie/weather/sensor/$properties", "temperature"],
      ["homie/weather/sensor/temperature/$datatype", "float"],
      ["homie/weather/$stats/uptime", "3600"],
      ["homie/weather/$stats/cputemp", "42.5"],
      ["homie/weather/$stats/battery", "78"],
      ["homie/weather/$stats/supply", "3.28"],
    ]);
    const payload = getLatestDevicePayload(
      messages,
      "homeassistant/device/homie_homie_weather/config",
    );

    expect(payload.device).toEqual(
      expect.objectContaining({
        name: "Weather Station",
        model: "weather-fw",
        sw_version: "1.2.3",
        connections: [["mac", "AA:BB:CC:DD:EE:FF"]],
      }),
    );
    expect(payload.components).toEqual(
      expect.objectContaining({
        homie_homie_weather_stats_uptime: expect.objectContaining({
          platform: "sensor",
          name: "Stats Uptime",
          state_topic: "homie/weather/$stats/uptime",
          entity_category: "diagnostic",
          device_class: "duration",
          unit_of_measurement: "s",
        }),
        homie_homie_weather_stats_cputemp: expect.objectContaining({
          platform: "sensor",
          name: "Stats CPU Temperature",
          state_topic: "homie/weather/$stats/cputemp",
          entity_category: "diagnostic",
          device_class: "temperature",
          unit_of_measurement: "°C",
        }),
        homie_homie_weather_stats_battery: expect.objectContaining({
          platform: "sensor",
          name: "Stats Battery",
          state_topic: "homie/weather/$stats/battery",
          entity_category: "diagnostic",
          device_class: "battery",
          unit_of_measurement: "%",
        }),
        homie_homie_weather_stats_supply: expect.objectContaining({
          platform: "sensor",
          name: "Stats Supply",
          state_topic: "homie/weather/$stats/supply",
          entity_category: "diagnostic",
          device_class: "voltage",
          unit_of_measurement: "V",
        }),
      }),
    );
  });

  it("emits removal transitions when legacy Homie stats disappear", () => {
    const bridge = new HomieHaDiscoveryBridge();
    publish(bridge, [
      ["homie/weather/$homie", "4.0.0"],
      ["homie/weather/$nodes", "sensor"],
      ["homie/weather/sensor/$properties", "temperature"],
      ["homie/weather/sensor/temperature/$datatype", "float"],
      ["homie/weather/$stats/battery", "78"],
    ]);

    const messages = publish(bridge, [["homie/weather/$stats/battery", ""]]);
    const [removalPayload, finalPayload] = getDevicePayloads(
      messages,
      "homeassistant/device/homie_homie_weather/config",
    );

    expect(removalPayload?.components.homie_homie_weather_stats_battery).toEqual({
      platform: "sensor",
    });
    expect(finalPayload?.components).not.toHaveProperty("homie_homie_weather_stats_battery");
    expect(finalPayload?.components).toHaveProperty("homie_homie_weather_sensor_temperature");
  });

  it("maps Homie v3 array metadata and boolean custom formats", () => {
    const bridge = new HomieHaDiscoveryBridge();
    const messages = publish(bridge, [
      ["homie/garage/$homie", "3.0.1"],
      ["homie/garage/$name", "Garage"],
      ["homie/garage/$nodes", "doors[]"],
      ["homie/garage/doors/$name", "Door"],
      ["homie/garage/doors/$array", "1-2"],
      ["homie/garage/doors/$properties", "position"],
      ["homie/garage/doors/position/$name", "Position"],
      ["homie/garage/doors/position/$datatype", "boolean"],
      ["homie/garage/doors/position/$format", "closed,open"],
      ["homie/garage/doors/position/$retained", "true"],
      ["homie/garage/doors_1/$name", "Left door"],
      ["homie/garage/doors_2/$name", "Right door"],
    ]);
    const payload = getLatestDevicePayload(
      messages,
      "homeassistant/device/homie_homie_garage/config",
    );

    expect(payload.components).toEqual(
      expect.objectContaining({
        homie_homie_garage_doors_1_position: expect.objectContaining({
          platform: "binary_sensor",
          name: "Left door Position",
          state_topic: "homie/garage/doors_1/position",
          payload_on: "open",
          payload_off: "closed",
        }),
        homie_homie_garage_doors_2_position: expect.objectContaining({
          platform: "binary_sensor",
          name: "Right door Position",
          state_topic: "homie/garage/doors_2/position",
          payload_on: "open",
          payload_off: "closed",
        }),
      }),
    );
  });

  it("emits removal transitions when Homie v5 properties disappear", () => {
    const bridge = new HomieHaDiscoveryBridge();
    publish(bridge, [["homie/5/supercar/$description", buildHomieV5SupercarDescription()]]);

    const nextDescription = JSON.stringify({
      homie: "5.0",
      name: "Supercar",
      version: 8,
      nodes: {
        lights: {
          name: "Lights",
          properties: {
            power: {
              name: "Power",
              datatype: "boolean",
              settable: true,
            },
          },
        },
      },
    });
    const messages = publish(bridge, [["homie/5/supercar/$description", nextDescription]]);
    const [removalPayload, finalPayload] = getDevicePayloads(messages);

    expect(removalPayload?.components.homie_homie_5_supercar_engine_speed).toEqual({
      platform: "sensor",
    });
    expect(removalPayload?.components.homie_homie_5_supercar_lights_mode).toEqual({
      platform: "select",
    });
    expect(finalPayload?.components).not.toHaveProperty("homie_homie_5_supercar_engine_speed");
    expect(finalPayload?.components).toHaveProperty("homie_homie_5_supercar_lights_power");
  });

  it("cleans discovery when a Homie v5 description is retained-deleted", () => {
    const bridge = new HomieHaDiscoveryBridge();
    publish(bridge, [["homie/5/supercar/$description", buildHomieV5SupercarDescription()]]);

    const result = bridge.ingest({
      topic: "homie/5/supercar/$description",
      payload: "",
      retain: true,
    });

    expect(result.warnings).toEqual([]);
    expectCleanupMessages(result.messages, "homie_homie_5_supercar");
  });

  it("cleans discovery when a Homie v5 description no longer contains valid properties", () => {
    const bridge = new HomieHaDiscoveryBridge();
    publish(bridge, [["homie/5/supercar/$description", buildHomieV5SupercarDescription()]]);

    const result = bridge.ingest({
      topic: "homie/5/supercar/$description",
      payload: JSON.stringify({ homie: "5.0", version: 8, nodes: {} }),
      retain: true,
    });

    expect(result.warnings).toEqual([expect.stringContaining("contains no valid properties")]);
    expectCleanupMessages(result.messages, "homie_homie_5_supercar");
  });

  it("emits removal transitions when legacy Homie properties disappear", () => {
    const bridge = new HomieHaDiscoveryBridge();
    publish(bridge, [
      ["homie/weather/$homie", "4.0.0"],
      ["homie/weather/$nodes", "sensor"],
      ["homie/weather/sensor/$name", "Outdoor"],
      ["homie/weather/sensor/$properties", "temperature,humidity"],
      ["homie/weather/sensor/temperature/$datatype", "float"],
      ["homie/weather/sensor/humidity/$datatype", "integer"],
    ]);

    const messages = publish(bridge, [["homie/weather/sensor/$properties", "temperature"]]);
    const [removalPayload, finalPayload] = getDevicePayloads(
      messages,
      "homeassistant/device/homie_homie_weather/config",
    );

    expect(removalPayload?.components.homie_homie_weather_sensor_humidity).toEqual({
      platform: "sensor",
    });
    expect(finalPayload?.components).not.toHaveProperty("homie_homie_weather_sensor_humidity");
    expect(finalPayload?.components).toHaveProperty("homie_homie_weather_sensor_temperature");
  });

  it("cleans discovery when a legacy Homie property list is retained-deleted", () => {
    const bridge = new HomieHaDiscoveryBridge();
    publish(bridge, [
      ["homie/weather/$homie", "4.0.0"],
      ["homie/weather/$nodes", "sensor"],
      ["homie/weather/sensor/$properties", "temperature"],
      ["homie/weather/sensor/temperature/$datatype", "float"],
    ]);

    const messages = publish(bridge, [["homie/weather/sensor/$properties", ""]]);

    expectCleanupMessages(messages, "homie_homie_weather");
  });

  it("cleans discovery when a legacy Homie node list is retained-deleted", () => {
    const bridge = new HomieHaDiscoveryBridge();
    publish(bridge, [
      ["homie/weather/$homie", "4.0.0"],
      ["homie/weather/$nodes", "sensor"],
      ["homie/weather/sensor/$properties", "temperature"],
      ["homie/weather/sensor/temperature/$datatype", "float"],
    ]);

    const messages = publish(bridge, [["homie/weather/$nodes", ""]]);

    expectCleanupMessages(messages, "homie_homie_weather");
  });

  it("cleans discovery without warnings when a required legacy Homie datatype is retained-deleted", () => {
    const bridge = new HomieHaDiscoveryBridge();
    publish(bridge, [
      ["homie/weather/$homie", "4.0.0"],
      ["homie/weather/$nodes", "sensor"],
      ["homie/weather/sensor/$properties", "temperature"],
      ["homie/weather/sensor/temperature/$datatype", "float"],
    ]);

    const result = bridge.ingest({
      topic: "homie/weather/sensor/temperature/$datatype",
      payload: "",
      retain: true,
    });

    expect(result.warnings).toEqual([]);
    expectCleanupMessages(result.messages, "homie_homie_weather");
  });

  it("cleans discovery when a required legacy Homie datatype becomes unsupported", () => {
    const bridge = new HomieHaDiscoveryBridge();
    publish(bridge, [
      ["homie/weather/$homie", "4.0.0"],
      ["homie/weather/$nodes", "sensor"],
      ["homie/weather/sensor/$properties", "temperature"],
      ["homie/weather/sensor/temperature/$datatype", "float"],
    ]);

    const result = bridge.ingest({
      topic: "homie/weather/sensor/temperature/$datatype",
      payload: "unsupported",
      retain: true,
    });

    expect(result.warnings).toEqual([expect.stringContaining("unsupported legacy Homie datatype")]);
    expectCleanupMessages(result.messages, "homie_homie_weather");
  });

  it("cleans discovery when a legacy Homie device changes to a disabled version", () => {
    const bridge = new HomieHaDiscoveryBridge({ enabledVersions: [4, 5] });
    publish(bridge, [
      ["homie/weather/$homie", "4.0.0"],
      ["homie/weather/$nodes", "sensor"],
      ["homie/weather/sensor/$properties", "temperature"],
      ["homie/weather/sensor/temperature/$datatype", "float"],
    ]);

    const result = bridge.ingest({
      topic: "homie/weather/$homie",
      payload: "3.0.1",
      retain: true,
    });

    expect(result.warnings).toEqual([]);
    expectCleanupMessages(result.messages, "homie_homie_weather");
  });
});
