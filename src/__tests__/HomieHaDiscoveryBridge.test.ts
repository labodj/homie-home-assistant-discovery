import { HomieHaDiscoveryBridge } from "../HomieHaDiscoveryBridge";

const buildDescription = (
  properties: Record<string, unknown>,
  extras: Record<string, unknown> = {},
): string =>
  JSON.stringify({
    homie: "5.0",
    version: 1,
    name: "Kitchen Controller",
    ...extras,
    nodes: {
      relay: {
        name: "Relay",
        properties,
      },
    },
  });

describe("HomieHaDiscoveryBridge", () => {
  it("generates Home Assistant device discovery from a Homie v5 description", () => {
    const bridge = new HomieHaDiscoveryBridge();
    const result = bridge.ingest({
      topic: "homie/5/kitchen/$description",
      payload: buildDescription({
        state: {
          datatype: "boolean",
          settable: true,
        },
      }),
      retain: true,
    });

    expect(result.warnings).toEqual([]);
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]).toEqual(
      expect.objectContaining({
        topic: "homeassistant/device/homie_homie_5_kitchen/config",
        retain: true,
      }),
    );
    expect(result.messages[0]?.payload).toEqual(
      expect.objectContaining({
        availability_topic: "homie/5/kitchen/$state",
        components: expect.objectContaining({
          homie_homie_5_kitchen_relay_state: expect.objectContaining({
            platform: "switch",
            unique_id: "homie_homie_5_kitchen_relay_state",
            default_entity_id: "switch.homie_homie_5_kitchen_relay_state",
            command_topic: "homie/5/kitchen/relay/state/set",
            state_topic: "homie/5/kitchen/relay/state",
          }),
        }),
      }),
    );
    const firstPayload = result.messages[0]?.payload as {
      components: Record<string, Record<string, unknown>>;
    };
    expect(firstPayload.components.homie_homie_5_kitchen_relay_state).not.toHaveProperty(
      "object_id",
    );
  });

  it("infers common Home Assistant boolean platforms from Homie v5 semantic metadata", () => {
    const bridge = new HomieHaDiscoveryBridge();
    const result = bridge.ingest({
      topic: "homie/5/room/$description",
      payload: JSON.stringify({
        homie: "5.0",
        version: 1,
        name: "Room Controller",
        nodes: {
          ceiling: {
            name: "Ceiling Light",
            type: "light",
            properties: {
              state: { datatype: "boolean", settable: true },
            },
          },
          ventilation: {
            name: "Ventilation Fan",
            type: "fan",
            properties: {
              state: { datatype: "boolean", settable: true },
            },
          },
          relay: {
            name: "Aux Relay",
            properties: {
              state: { datatype: "boolean", settable: true },
            },
          },
        },
      }),
      retain: true,
    });

    expect(result.messages[0]?.payload).toEqual(
      expect.objectContaining({
        components: expect.objectContaining({
          homie_homie_5_room_ceiling_state: expect.objectContaining({
            platform: "light",
            name: "Ceiling Light",
            default_entity_id: "light.homie_homie_5_room_ceiling_state",
          }),
          homie_homie_5_room_ventilation_state: expect.objectContaining({
            platform: "fan",
            name: "Ventilation Fan",
            default_entity_id: "fan.homie_homie_5_room_ventilation_state",
          }),
          homie_homie_5_room_relay_state: expect.objectContaining({
            platform: "switch",
            name: "Aux Relay",
            default_entity_id: "switch.homie_homie_5_room_relay_state",
          }),
        }),
      }),
    );
  });

  it("allows conservative boolean mapping when automatic semantics are not wanted", () => {
    const bridge = new HomieHaDiscoveryBridge({ defaultCommandableBooleanPlatform: "switch" });
    const result = bridge.ingest({
      topic: "homie/5/room/$description",
      payload: JSON.stringify({
        homie: "5.0",
        version: 1,
        nodes: {
          ceiling: {
            name: "Ceiling Light",
            type: "light",
            properties: {
              state: { datatype: "boolean", settable: true },
            },
          },
        },
      }),
      retain: true,
    });

    expect(result.messages[0]?.payload).toEqual(
      expect.objectContaining({
        components: expect.objectContaining({
          homie_homie_5_room_ceiling_state: expect.objectContaining({
            platform: "switch",
            default_entity_id: "switch.homie_homie_5_room_ceiling_state",
          }),
        }),
      }),
    );
  });

  it("can preserve LSH-style Home Assistant device and entity identities", () => {
    const bridge = new HomieHaDiscoveryBridge({
      idPrefix: "lsh",
      overrides: {
        deviceDefaults: {
          objectId: "lsh_{deviceId}",
          identifiers: ["LSH_{deviceId}"],
          manufacturer: "Jacopo Labardi",
          model: "Labo Smart Home",
        },
        namedNodeState: {
          exclusive: true,
          platform: "light",
          objectId: "lsh_{deviceId}_{nodeId}",
          defaultEntityId: "{platform}.{objectId}",
        },
        devices: {
          c1: {
            name: "c1",
            nodeNames: {
              "1": "Esterno ingresso",
              "2": {
                name: "Ventola",
                platform: "fan",
              },
            },
          },
        },
      },
    });

    const result = bridge.ingest({
      topic: "homie/5/c1/$description",
      payload: JSON.stringify({
        homie: "5.0",
        version: 1,
        name: "c1",
        nodes: {
          "1": {
            name: "Output 1",
            properties: {
              state: {
                datatype: "boolean",
                settable: true,
              },
            },
          },
          "2": {
            name: "Output 2",
            properties: {
              state: {
                datatype: "boolean",
                settable: true,
              },
            },
          },
          "99": {
            name: "Unconfigured Output",
            properties: {
              state: {
                datatype: "boolean",
                settable: true,
              },
            },
          },
        },
      }),
      retain: true,
    });

    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]).toEqual(
      expect.objectContaining({
        topic: "homeassistant/device/lsh_c1/config",
      }),
    );
    expect(result.messages[0]?.payload).toEqual(
      expect.objectContaining({
        device: expect.objectContaining({
          identifiers: ["LSH_c1"],
          manufacturer: "Jacopo Labardi",
          model: "Labo Smart Home",
          name: "c1",
        }),
        components: expect.objectContaining({
          lsh_c1_1: expect.objectContaining({
            platform: "light",
            name: "Esterno ingresso",
            unique_id: "lsh_c1_1",
            default_entity_id: "light.lsh_c1_1",
            state_topic: "homie/5/c1/1/state",
            command_topic: "homie/5/c1/1/state/set",
          }),
          lsh_c1_2: expect.objectContaining({
            platform: "fan",
            name: "Ventola",
            unique_id: "lsh_c1_2",
            default_entity_id: "fan.lsh_c1_2",
            state_topic: "homie/5/c1/2/state",
            command_topic: "homie/5/c1/2/state/set",
          }),
        }),
      }),
    );
    expect((result.messages[0]?.payload as Record<string, unknown>).components).not.toHaveProperty(
      "lsh_c1_99_state",
    );
    expect(result.messages[1]).toEqual(
      expect.objectContaining({
        topic: "homeassistant/sensor/lsh_c1_homie_state/config",
        payload: expect.objectContaining({
          default_entity_id: "sensor.lsh_c1_homie_state",
        }),
      }),
    );
  });

  it("keeps override precedence predictable from simple shortcuts to exact exceptions", () => {
    const bridge = new HomieHaDiscoveryBridge({
      overrides: {
        deviceDefaults: {
          objectId: "fleet_{deviceId}",
          identifiers: ["fleet:{baseTopic}", "{rootSlug}:{deviceId}"],
          viaDevice: "gateway:{rootSlug}",
        },
        namedNodeState: {
          platform: "light",
          objectId: "fleet_{deviceId}_{nodeId}",
          ha: {
            availability: [{ topic: "{baseTopic}/$state" }],
          },
        },
        rules: [
          {
            match: {
              propertyId: "state",
              datatype: "boolean",
              settable: true,
              configuredNode: true,
            },
            icon: "mdi:lightbulb",
          },
          {
            match: { nodeId: "pump", propertyId: "state" },
            platform: "fan",
            icon: "mdi:fan",
          },
        ],
        devices: {
          "homie/5/utility": {
            name: "Utility Controller",
            nodeNames: {
              lamp: "Utility Lamp",
              pump: "Circulation Pump",
              override: {
                name: "Manual Override",
                platform: "switch",
                icon: "mdi:toggle-switch",
              },
            },
          },
        },
      },
    });

    const result = bridge.ingest({
      topic: "homie/5/utility/$description",
      payload: JSON.stringify({
        homie: "5.0",
        version: 1,
        nodes: {
          lamp: {
            properties: {
              state: { datatype: "boolean", settable: true },
            },
          },
          pump: {
            properties: {
              state: { datatype: "boolean", settable: true },
            },
          },
          override: {
            properties: {
              state: { datatype: "boolean", settable: true },
            },
          },
          spare: {
            properties: {
              state: { datatype: "boolean", settable: true },
            },
          },
        },
      }),
      retain: true,
    });

    expect(result.messages[0]).toEqual(
      expect.objectContaining({
        topic: "homeassistant/device/fleet_utility/config",
      }),
    );
    expect(result.messages[0]?.payload).toEqual(
      expect.objectContaining({
        device: expect.objectContaining({
          identifiers: ["fleet:homie/5/utility", "homie:utility"],
          name: "Utility Controller",
          via_device: "gateway:homie",
        }),
        components: expect.objectContaining({
          fleet_utility_lamp: expect.objectContaining({
            platform: "light",
            name: "Utility Lamp",
            icon: "mdi:lightbulb",
            availability: [{ topic: "homie/5/utility/$state" }],
          }),
          fleet_utility_pump: expect.objectContaining({
            platform: "fan",
            name: "Circulation Pump",
            icon: "mdi:fan",
          }),
          fleet_utility_override: expect.objectContaining({
            platform: "switch",
            name: "Manual Override",
            icon: "mdi:toggle-switch",
          }),
          fleet_utility_spare_state: expect.objectContaining({
            platform: "switch",
            name: "Spare State",
          }),
        }),
      }),
    );
  });

  it("supports multi-segment Homie v5 domains", () => {
    const bridge = new HomieHaDiscoveryBridge({
      homieDomain: "building/homie",
    });
    const result = bridge.ingest({
      topic: "building/homie/5/kitchen/$description",
      payload: buildDescription({
        state: {
          datatype: "boolean",
          settable: true,
        },
      }),
    });

    expect(result.messages[0]).toEqual(
      expect.objectContaining({
        topic: "homeassistant/device/homie_building_homie_5_kitchen/config",
      }),
    );
    expect(result.messages[0]?.payload).toEqual(
      expect.objectContaining({
        availability_topic: "building/homie/5/kitchen/$state",
      }),
    );
  });

  it("adds extension-agnostic diagnostics from observed v5 attribute topics", () => {
    const bridge = new HomieHaDiscoveryBridge({
      overrides: {
        devices: {
          "homie/5/kitchen": {
            objectId: "acme_kitchen",
          },
        },
      },
    });
    bridge.ingest({
      topic: "homie/5/kitchen/$description",
      payload: buildDescription({
        state: {
          datatype: "boolean",
          settable: true,
        },
      }),
      retain: true,
    });
    bridge.ingest({
      topic: "homie/5/kitchen/$implementation/ota/enabled",
      payload: "true",
      retain: true,
    });
    bridge.ingest({
      topic: "homie/5/kitchen/$implementation/config",
      payload: JSON.stringify({ mqtt: { effective_base_topic: "homie" } }),
      retain: true,
    });
    bridge.ingest({
      topic: "homie/5/kitchen/$mac",
      payload: "AA:BB:CC:DD:EE:FF",
      retain: true,
    });
    bridge.ingest({
      topic: "homie/5/kitchen/$fw/version",
      payload: "1.2.3",
      retain: true,
    });
    const result = bridge.ingest({
      topic: "homie/5/kitchen/$stats/mqttinbounddropped",
      payload: "3",
      retain: true,
    });
    const payload = result.messages[0]?.payload;

    expect(payload).toEqual(
      expect.objectContaining({
        device: expect.objectContaining({
          connections: [["mac", "AA:BB:CC:DD:EE:FF"]],
          sw_version: "1.2.3",
        }),
        components: expect.objectContaining({
          acme_kitchen_implementation_ota_enabled: expect.objectContaining({
            platform: "binary_sensor",
            entity_category: "diagnostic",
            state_topic: "homie/5/kitchen/$implementation/ota/enabled",
            payload_on: "true",
            payload_off: "false",
          }),
          acme_kitchen_implementation_config: expect.objectContaining({
            platform: "sensor",
            entity_category: "diagnostic",
            state_topic: "homie/5/kitchen/$implementation/config",
            value_template: "{{ 'configured' }}",
            json_attributes_topic: "homie/5/kitchen/$implementation/config",
          }),
          acme_kitchen_stats_mqtt_inbound_dropped: expect.objectContaining({
            platform: "sensor",
            state_topic: "homie/5/kitchen/$stats/mqttinbounddropped",
            state_class: "total_increasing",
          }),
          acme_kitchen_description_version: expect.objectContaining({
            platform: "sensor",
            entity_category: "diagnostic",
            state_topic: "homie/5/kitchen/$description",
            value_template: "{{ value_json.version }}",
          }),
          acme_kitchen_description_extensions: expect.objectContaining({
            platform: "sensor",
            entity_category: "diagnostic",
            state_topic: "homie/5/kitchen/$description",
            value_template: "{{ value_json.extensions | default([]) | join(',') }}",
          }),
        }),
      }),
    );
  });

  it("lets overrides refine observed v5 attribute diagnostics", () => {
    const bridge = new HomieHaDiscoveryBridge({
      overrides: {
        devices: {
          "homie/5/kitchen": {
            objectId: "acme_kitchen",
            properties: {
              "diagnostics/stats-mqtt-inbound-dropped": {
                name: "MQTT Dropped Messages",
                objectId: "acme_kitchen_mqtt_dropped",
                icon: "mdi:counter",
                unit: "messages",
                stateClass: "total_increasing",
                suggestedDisplayPrecision: 0,
                ha: {
                  availability: [
                    {
                      topic: "homie/5/kitchen/$state",
                      payload_available: "ready",
                      payload_not_available: "lost",
                    },
                  ],
                },
              },
            },
          },
        },
      },
    });
    bridge.ingest({
      topic: "homie/5/kitchen/$description",
      payload: buildDescription({
        state: {
          datatype: "boolean",
          settable: true,
        },
      }),
      retain: true,
    });
    const result = bridge.ingest({
      topic: "homie/5/kitchen/$stats/mqttinbounddropped",
      payload: "3",
      retain: true,
    });

    expect(result.messages[0]?.payload).toEqual(
      expect.objectContaining({
        components: expect.objectContaining({
          acme_kitchen_mqtt_dropped: expect.objectContaining({
            platform: "sensor",
            name: "MQTT Dropped Messages",
            icon: "mdi:counter",
            unit_of_measurement: "messages",
            state_class: "total_increasing",
            suggested_display_precision: 0,
            availability: [
              {
                topic: "homie/5/kitchen/$state",
                payload_available: "ready",
                payload_not_available: "lost",
              },
            ],
          }),
        }),
      }),
    );
  });

  it("queues observed v5 attributes until the description is available", () => {
    const bridge = new HomieHaDiscoveryBridge();

    expect(
      bridge.ingest({
        topic: "homie/5/kitchen/$implementation/ota/enabled",
        payload: "false",
        retain: true,
      }).messages,
    ).toEqual([]);

    const result = bridge.ingest({
      topic: "homie/5/kitchen/$description",
      payload: buildDescription({
        state: {
          datatype: "boolean",
          settable: true,
        },
      }),
      retain: true,
    });
    const payload = result.messages[0]?.payload;

    expect(payload).toEqual(
      expect.objectContaining({
        components: expect.objectContaining({
          homie_homie_5_kitchen_implementation_ota_enabled: expect.objectContaining({
            platform: "binary_sensor",
            state_topic: "homie/5/kitchen/$implementation/ota/enabled",
          }),
        }),
      }),
    );
  });

  it("ignores v5 attribute diagnostics when disabled", () => {
    const bridge = new HomieHaDiscoveryBridge({ includeAttributeDiagnostics: false });
    bridge.ingest({
      topic: "homie/5/kitchen/$implementation/ota/enabled",
      payload: "true",
      retain: true,
    });
    const result = bridge.ingest({
      topic: "homie/5/kitchen/$description",
      payload: buildDescription({
        state: {
          datatype: "boolean",
          settable: true,
        },
      }),
      retain: true,
    });

    expect(result.messages[0]?.payload).toEqual(
      expect.objectContaining({
        components: expect.not.objectContaining({
          homie_homie_5_kitchen_implementation_ota_enabled: expect.anything(),
        }),
      }),
    );
  });

  it("does not expose operational Homie v5 attributes as diagnostics", () => {
    const bridge = new HomieHaDiscoveryBridge();
    const descriptionResult = bridge.ingest({
      topic: "homie/5/kitchen/$description",
      payload: buildDescription({
        state: {
          datatype: "boolean",
          settable: true,
        },
      }),
      retain: true,
    });

    expect(descriptionResult.messages[0]?.payload).toEqual(
      expect.objectContaining({
        components: expect.not.objectContaining({
          homie_homie_5_kitchen_description: expect.anything(),
        }),
      }),
    );
    expect(
      bridge.ingest({
        topic: "homie/5/kitchen/$log/warn",
        payload: "battery low",
        retain: false,
      }).messages,
    ).toEqual([]);
    expect(
      bridge.ingest({
        topic: "homie/5/kitchen/$alert/battery",
        payload: "Battery low",
        retain: true,
      }).messages,
    ).toEqual([]);
  });

  it("removes observed v5 attribute diagnostics when retained attributes are deleted", () => {
    const bridge = new HomieHaDiscoveryBridge();
    bridge.ingest({
      topic: "homie/5/kitchen/$description",
      payload: buildDescription({
        state: {
          datatype: "boolean",
          settable: true,
        },
      }),
      retain: true,
    });
    bridge.ingest({
      topic: "homie/5/kitchen/$stats/signal",
      payload: "-42",
      retain: true,
    });

    const result = bridge.ingest({
      topic: "homie/5/kitchen/$stats/signal",
      payload: "",
      retain: true,
    });

    expect(result.messages[0]?.payload).toEqual(
      expect.objectContaining({
        components: expect.objectContaining({
          homie_homie_5_kitchen_stats_signal: { platform: "sensor" },
        }),
      }),
    );
    expect(result.messages[1]?.payload).toEqual(
      expect.objectContaining({
        components: expect.not.objectContaining({
          homie_homie_5_kitchen_stats_signal: expect.anything(),
        }),
      }),
    );
  });

  it("is idempotent for unchanged descriptions", () => {
    const bridge = new HomieHaDiscoveryBridge();
    const input = {
      topic: "homie/5/kitchen/$description",
      payload: buildDescription({
        state: {
          datatype: "boolean",
          settable: true,
        },
      }),
      retain: true,
    };

    expect(bridge.ingest(input).messages).toHaveLength(2);
    expect(bridge.ingest(input).messages).toHaveLength(0);
  });

  it("emits cleanup messages when a published device is removed", () => {
    const bridge = new HomieHaDiscoveryBridge();
    bridge.ingest({
      topic: "homie/5/kitchen/$description",
      payload: buildDescription({
        state: {
          datatype: "boolean",
          settable: true,
        },
      }),
      retain: true,
    });

    const result = bridge.ingest({
      topic: "homie/5/kitchen/$state",
      payload: "",
      retain: true,
    });

    expect(result.messages).toEqual([
      expect.objectContaining({
        topic: "homeassistant/device/homie_homie_5_kitchen/config",
        payload: "",
      }),
      expect.objectContaining({
        topic: "homeassistant/sensor/homie_homie_5_kitchen_homie_state/config",
        payload: "",
      }),
    ]);
  });

  it("ignores Homie v5 topics with invalid device ids", () => {
    const bridge = new HomieHaDiscoveryBridge();
    const result = bridge.ingest({
      topic: "homie/5/Kitchen/$description",
      payload: buildDescription({
        state: {
          datatype: "boolean",
          settable: true,
        },
      }),
      retain: true,
    });

    expect(result.messages).toEqual([]);
    expect(result.warnings).toEqual(["Ignored Homie device 'Kitchen' because id is invalid."]);
  });

  it("does not reinterpret future Homie major topics as legacy metadata", () => {
    const bridge = new HomieHaDiscoveryBridge();
    const result = bridge.ingest({
      topic: "homie/6/kitchen/$description",
      payload: JSON.stringify({
        homie: "6.0",
        nodes: {},
      }),
      retain: true,
    });

    expect(result.messages).toEqual([]);
    expect(result.warnings).toEqual([
      "Ignored Homie topic 'homie/6/kitchen/$description' because Homie major version 6 is not supported.",
    ]);
  });

  it("still accepts legacy Homie devices with numeric ids", () => {
    const bridge = new HomieHaDiscoveryBridge();
    const messages = [
      ["homie/6/$homie", "4.0.0"],
      ["homie/6/$nodes", "sensor"],
      ["homie/6/sensor/$properties", "temperature"],
      ["homie/6/sensor/temperature/$datatype", "float"],
    ] as const;

    const results = messages.map(([topic, payload]) => bridge.ingest({ topic, payload }));

    expect(results.flatMap((result) => result.messages)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          topic: "homeassistant/device/homie_homie_6/config",
        }),
      ]),
    );
  });

  it("collects legacy Homie v4 topic metadata", () => {
    const bridge = new HomieHaDiscoveryBridge();
    const messages = [
      ["homie/legacy/$homie", "4.0.0"],
      ["homie/legacy/$name", "Legacy Device"],
      ["homie/legacy/$nodes", "relay"],
      ["homie/legacy/relay/$name", "Relay"],
      ["homie/legacy/relay/$properties", "power"],
      ["homie/legacy/relay/power/$datatype", "boolean"],
      ["homie/legacy/relay/power/$settable", "true"],
    ] as const;

    const results = messages.map(([topic, payload]) => bridge.ingest({ topic, payload }));
    const discoveryMessages = results.flatMap((result) => result.messages);

    expect(discoveryMessages.at(-2)).toEqual(
      expect.objectContaining({
        topic: "homeassistant/device/homie_homie_legacy/config",
      }),
    );
  });

  it("ignores legacy Homie topics with invalid device ids", () => {
    const bridge = new HomieHaDiscoveryBridge();
    const result = bridge.ingest({ topic: "homie/bad_device/$homie", payload: "4.0.0" });

    expect(result.messages).toEqual([]);
    expect(result.warnings).toEqual(["Ignored Homie device 'bad_device' because id is invalid."]);
  });

  it("warns for invalid legacy Homie property list entries", () => {
    const bridge = new HomieHaDiscoveryBridge();
    const result = bridge.ingest({
      topic: "homie/legacy/relay/$properties",
      payload: "power,bad_property",
    });

    expect(result.messages).toEqual([]);
    expect(result.warnings).toEqual([
      "Ignored invalid legacy Homie property list entry 'bad_property' for 'legacy/relay'.",
    ]);
  });

  it("clears collected legacy Homie metadata on reset", () => {
    const bridge = new HomieHaDiscoveryBridge();
    const messages = [
      ["homie/legacy/$homie", "4.0.0"],
      ["homie/legacy/$name", "Legacy Device"],
      ["homie/legacy/$nodes", "relay"],
      ["homie/legacy/relay/$properties", "power"],
      ["homie/legacy/relay/power/$datatype", "boolean"],
    ] as const;

    messages.forEach(([topic, payload]) => bridge.ingest({ topic, payload }));

    expect(bridge.reset()).toHaveLength(2);
    expect(
      bridge.ingest({
        topic: "homie/legacy/relay/power/$unit",
        payload: "%",
      }).messages,
    ).toEqual([]);
  });

  it("does not publish discovery for disabled Homie versions", () => {
    const bridge = new HomieHaDiscoveryBridge({
      enabledVersions: [4, 5],
    });
    const messages = [
      ["homie/legacy/$homie", "3.0.1"],
      ["homie/legacy/$nodes", "relay"],
      ["homie/legacy/relay/$properties", "power"],
      ["homie/legacy/relay/power/$datatype", "boolean"],
      ["homie/legacy/relay/power/$settable", "true"],
    ] as const;

    const results = messages.map(([topic, payload]) => bridge.ingest({ topic, payload }));

    expect(results.flatMap((result) => result.messages)).toEqual([]);
  });

  it("supports multi-segment legacy Homie roots", () => {
    const bridge = new HomieHaDiscoveryBridge({
      legacyRoot: "building/homie",
    });
    const messages = [
      ["building/homie/legacy/$homie", "4.0.0"],
      ["building/homie/legacy/$name", "Legacy Device"],
      ["building/homie/legacy/$nodes", "relay"],
      ["building/homie/legacy/relay/$name", "Relay"],
      ["building/homie/legacy/relay/$properties", "power"],
      ["building/homie/legacy/relay/power/$datatype", "boolean"],
      ["building/homie/legacy/relay/power/$settable", "true"],
    ] as const;

    const result = messages.map(([topic, payload]) => bridge.ingest({ topic, payload })).at(-1);

    expect(result?.messages.at(-2)).toEqual(
      expect.objectContaining({
        topic: "homeassistant/device/homie_building_homie_legacy/config",
      }),
    );
  });

  it("expands legacy Homie array nodes into stable Home Assistant components", () => {
    const bridge = new HomieHaDiscoveryBridge();
    const messages = [
      ["homie/car/$homie", "3.0.1"],
      ["homie/car/$name", "Car"],
      ["homie/car/$nodes", "lights[]"],
      ["homie/car/lights/$name", "Lights"],
      ["homie/car/lights/$array", "0-1"],
      ["homie/car/lights/$properties", "power"],
      ["homie/car/lights/power/$datatype", "boolean"],
      ["homie/car/lights/power/$settable", "true"],
      ["homie/car/lights_0/$name", "Back lights"],
      ["homie/car/lights_1/$name", "Front lights"],
    ] as const;

    const result = messages.map(([topic, payload]) => bridge.ingest({ topic, payload })).at(-1);
    const payload = result?.messages.at(-2)?.payload;

    expect(payload).toEqual(
      expect.objectContaining({
        components: expect.objectContaining({
          homie_homie_car_lights_0_power: expect.objectContaining({
            name: "Back lights Power",
            state_topic: "homie/car/lights_0/power",
            command_topic: "homie/car/lights_0/power/set",
          }),
          homie_homie_car_lights_1_power: expect.objectContaining({
            name: "Front lights Power",
            state_topic: "homie/car/lights_1/power",
            command_topic: "homie/car/lights_1/power/set",
          }),
        }),
      }),
    );
  });

  it("applies device and property discovery overrides", () => {
    const bridge = new HomieHaDiscoveryBridge({
      overrides: {
        devices: {
          "homie/5/kitchen": {
            name: "Kitchen Board",
            objectId: "acme_kitchen",
            manufacturer: "Acme",
            model: "Bridge",
            identifiers: ["acme-kitchen"],
            properties: {
              "relay/state": {
                platform: "light",
                name: "Ceiling",
                objectId: "acme_kitchen_1",
                defaultEntityId: "light.legacy_ceiling",
                icon: "mdi:ceiling-light",
                payloadOn: "ON",
                payloadOff: "OFF",
              },
            },
          },
        },
      },
    });

    const result = bridge.ingest({
      topic: "homie/5/kitchen/$description",
      payload: buildDescription({
        state: {
          datatype: "boolean",
          settable: true,
        },
      }),
      retain: true,
    });
    const payload = result.messages[0]?.payload;

    expect(payload).toEqual(
      expect.objectContaining({
        device: expect.objectContaining({
          name: "Kitchen Board",
          manufacturer: "Acme",
          model: "Bridge",
          identifiers: ["acme-kitchen"],
        }),
        components: expect.objectContaining({
          acme_kitchen_1: expect.objectContaining({
            platform: "light",
            name: "Ceiling",
            unique_id: "acme_kitchen_1",
            default_entity_id: "light.legacy_ceiling",
            icon: "mdi:ceiling-light",
            payload_on: "ON",
            payload_off: "OFF",
          }),
        }),
      }),
    );
    expect(result.messages[0]?.topic).toBe("homeassistant/device/acme_kitchen/config");
  });
});
