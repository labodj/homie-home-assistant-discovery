import { validateDiscoveryOverrides } from "../overrides";

describe("discovery override validation", () => {
  it("accepts compact defaults and node name maps", () => {
    expect(
      validateDiscoveryOverrides({
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
            nodeNames: {
              "1": "Esterno ingresso",
              "3": {
                name: "Ventola",
                platform: "fan",
                icon: "mdi:fan",
              },
            },
            nodes: {
              "2": {
                name: "Esterno camerina",
              },
            },
          },
        },
        rules: [
          {
            match: {
              majorVersion: 5,
              path: "*/state",
              datatype: "boolean",
              settable: true,
              configuredNode: true,
            },
            platform: "light",
            objectId: "lsh_{deviceId}_{nodeId}",
          },
        ],
      }),
    ).toEqual({
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
          nodeNames: {
            "1": "Esterno ingresso",
            "3": "Ventola",
          },
          nodes: {
            "1": {
              name: "Esterno ingresso",
            },
            "2": {
              name: "Esterno camerina",
            },
            "3": {
              name: "Ventola",
              properties: {
                state: {
                  name: "Ventola",
                  platform: "fan",
                  icon: "mdi:fan",
                },
              },
            },
          },
        },
      },
      rules: [
        {
          match: {
            majorVersion: 5,
            path: "*/state",
            datatype: "boolean",
            settable: true,
            configuredNode: true,
          },
          platform: "light",
          objectId: "lsh_{deviceId}_{nodeId}",
        },
      ],
    });
  });

  it("accepts valid nested overrides", () => {
    expect(
      validateDiscoveryOverrides({
        devices: {
          "homie/5/kitchen": {
            name: "Kitchen Board",
            objectId: "acme_kitchen",
            manufacturer: "Acme",
            model: "Bridge",
            identifiers: ["kitchen"],
            viaDevice: "homie:root",
            nodes: {
              relay: {
                name: "Relay",
                properties: {
                  state: {
                    platform: "light",
                    name: "Ceiling",
                    defaultEntityId: "light.kitchen_ceiling",
                    entityCategory: "diagnostic",
                    stateClass: "measurement",
                    jsonAttributesTopic: "homie/5/kitchen/relay/state/attrs",
                    jsonAttributesTemplate: "{{ value_json.attrs | tojson }}",
                    forceUpdate: true,
                    enabledByDefault: false,
                    entityPicture: "https://example.test/ceiling.png",
                    expireAfter: 120,
                    suggestedDisplayPrecision: 1,
                    options: ["auto", "manual"],
                    min: 0,
                    max: 100,
                    step: 5,
                    ha: {
                      availability: [
                        {
                          topic: "homie/5/kitchen/$state",
                          payload_available: "ready",
                        },
                      ],
                      optimistic: false,
                    },
                  },
                },
              },
            },
          },
        },
        rules: [
          {
            match: {
              baseTopic: "homie/5/*",
              datatype: "boolean",
              settable: true,
              path: ["lights/state", "fan/state"],
            },
            platform: "light",
            payloadOn: "ON",
            payloadOff: "OFF",
          },
        ],
      }),
    ).toEqual({
      devices: {
        "homie/5/kitchen": {
          name: "Kitchen Board",
          objectId: "acme_kitchen",
          manufacturer: "Acme",
          model: "Bridge",
          identifiers: ["kitchen"],
          viaDevice: "homie:root",
          nodes: {
            relay: {
              name: "Relay",
              properties: {
                state: {
                  platform: "light",
                  name: "Ceiling",
                  defaultEntityId: "light.kitchen_ceiling",
                  entityCategory: "diagnostic",
                  stateClass: "measurement",
                  jsonAttributesTopic: "homie/5/kitchen/relay/state/attrs",
                  jsonAttributesTemplate: "{{ value_json.attrs | tojson }}",
                  forceUpdate: true,
                  enabledByDefault: false,
                  entityPicture: "https://example.test/ceiling.png",
                  expireAfter: 120,
                  suggestedDisplayPrecision: 1,
                  options: ["auto", "manual"],
                  min: 0,
                  max: 100,
                  step: 5,
                  ha: {
                    availability: [
                      {
                        topic: "homie/5/kitchen/$state",
                        payload_available: "ready",
                      },
                    ],
                    optimistic: false,
                  },
                },
              },
            },
          },
        },
      },
      rules: [
        {
          match: {
            baseTopic: "homie/5/*",
            datatype: "boolean",
            settable: true,
            path: ["lights/state", "fan/state"],
          },
          platform: "light",
          payloadOn: "ON",
          payloadOff: "OFF",
        },
      ],
    });
  });

  it("rejects malformed override roots and unknown fields", () => {
    expect(() => validateDiscoveryOverrides([])).toThrow(/overrides.*object/);
    expect(() => validateDiscoveryOverrides({ devices: {}, unexpected: true })).toThrow(
      /Unknown discovery override field 'overrides.unexpected'/,
    );
  });

  it("rejects invalid property override values", () => {
    expect(() =>
      validateDiscoveryOverrides({
        devices: {
          kitchen: {
            properties: {
              "relay/state": {
                platform: "cover",
              },
            },
          },
        },
      }),
    ).toThrow(/platform.*supported Home Assistant platform/);

    expect(() =>
      validateDiscoveryOverrides({
        devices: {
          kitchen: {
            properties: {
              "relay/state": {
                options: ["auto", 1],
              },
            },
          },
        },
      }),
    ).toThrow(/options.*array of non-empty strings/);

    expect(() =>
      validateDiscoveryOverrides({
        rules: [
          {
            match: { datatype: "unsupported" },
            platform: "sensor",
          },
        ],
      }),
    ).toThrow(/datatype.*supported Homie datatype/);

    expect(() =>
      validateDiscoveryOverrides({
        rules: [
          {
            match: { unknown: "value" },
            platform: "sensor",
          },
        ],
      }),
    ).toThrow(/Unknown discovery override field 'overrides.rules.0.match.unknown'/);

    expect(() =>
      validateDiscoveryOverrides({
        devices: {
          kitchen: {
            properties: {
              "relay/state": {
                ha: {
                  unique_id: "broken",
                },
              },
            },
          },
        },
      }),
    ).toThrow(/ha.unique_id.*managed by the mapper/);

    expect(() =>
      validateDiscoveryOverrides({
        devices: {
          kitchen: {
            properties: {
              "relay/state": {
                ha: {
                  default_entity_id: "light.broken",
                },
              },
            },
          },
        },
      }),
    ).toThrow(/ha.default_entity_id.*managed by the mapper/);

    expect(() =>
      validateDiscoveryOverrides({
        devices: {
          kitchen: {
            properties: {
              "relay/state": {
                ha: {
                  custom_number: Number.POSITIVE_INFINITY,
                },
              },
            },
          },
        },
      }),
    ).toThrow(/ha.custom_number.*valid JSON data/);

    expect(() =>
      validateDiscoveryOverrides({
        devices: {
          kitchen: {
            properties: {
              "relay/state": {
                step: 0,
              },
            },
          },
        },
      }),
    ).toThrow(/step.*greater than zero/);

    expect(() =>
      validateDiscoveryOverrides({
        devices: {
          kitchen: {
            properties: {
              "relay/state": {
                min: 10,
                max: 1,
              },
            },
          },
        },
      }),
    ).toThrow(/max.*greater than or equal to min/);

    expect(() =>
      validateDiscoveryOverrides({
        devices: {
          kitchen: {
            properties: {
              "relay/state": {
                expireAfter: 0,
              },
            },
          },
        },
      }),
    ).toThrow(/expireAfter.*greater than zero/);

    expect(() =>
      validateDiscoveryOverrides({
        devices: {
          kitchen: {
            properties: {
              "relay/state": {
                suggestedDisplayPrecision: 1.5,
              },
            },
          },
        },
      }),
    ).toThrow(/suggestedDisplayPrecision.*non-negative integer/);
  });

  it("rejects invalid device, node and rule shapes", () => {
    expect(() =>
      validateDiscoveryOverrides({
        devices: {
          kitchen: {
            objectId: "",
          },
        },
      }),
    ).toThrow(/objectId.*non-empty string/);

    expect(() =>
      validateDiscoveryOverrides({
        devices: {
          kitchen: {
            nodes: {
              relay: {
                properties: "bad",
              },
            },
          },
        },
      }),
    ).toThrow(/properties.*object/);

    expect(() =>
      validateDiscoveryOverrides({
        rules: {},
      }),
    ).toThrow(/rules.*array/);

    expect(() =>
      validateDiscoveryOverrides({
        rules: [
          {
            match: {},
            platform: "sensor",
          },
        ],
      }),
    ).toThrow(/must contain at least one matcher/);

    expect(() =>
      validateDiscoveryOverrides({
        rules: [
          {
            match: { majorVersion: [3, 6] },
            platform: "sensor",
          },
        ],
      }),
    ).toThrow(/major version 3, 4 or 5/);

    expect(() =>
      validateDiscoveryOverrides({
        rules: [
          {
            match: { datatype: [] },
            platform: "sensor",
          },
        ],
      }),
    ).toThrow(/must not be an empty array/);

    expect(() =>
      validateDiscoveryOverrides({
        rules: [
          {
            match: { nodeId: "relay" },
          },
        ],
      }),
    ).toThrow(/must contain at least one override field/);

    expect(() =>
      validateDiscoveryOverrides({
        namedNodeState: {
          exclusive: "yes",
        },
      }),
    ).toThrow(/exclusive.*boolean/);

    expect(() =>
      validateDiscoveryOverrides({
        devices: {
          kitchen: {
            nodeNames: {
              relay: {
                platform: "light",
              },
            },
          },
        },
      }),
    ).toThrow(/nodeNames\.relay\.name.*required/);
  });
});
