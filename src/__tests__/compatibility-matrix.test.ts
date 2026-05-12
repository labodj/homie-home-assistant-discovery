import { HomieHaDiscoveryBridge } from "../HomieHaDiscoveryBridge";
import type { DiscoveryMessage } from "../types";

type ComponentConfig = Record<string, unknown>;

type DeviceDiscoveryPayload = {
  components: Record<string, ComponentConfig>;
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

const getComponent = (payload: DeviceDiscoveryPayload, componentId: string): ComponentConfig => {
  const component = payload.components[componentId];
  if (!component) {
    throw new Error(`Expected component '${componentId}'.`);
  }
  return component;
};

const legacyPropertyMessages = (
  deviceId: string,
  nodeId: string,
  propertyId: string,
  datatype: string,
  options: {
    format?: string;
    settable?: boolean;
    retained?: boolean;
    unit?: string;
  } = {},
): Array<readonly [string, string]> => [
  [`homie/${deviceId}/${nodeId}/${propertyId}/$datatype`, datatype],
  ...(options.format
    ? [[`homie/${deviceId}/${nodeId}/${propertyId}/$format`, options.format] as const]
    : []),
  ...(options.settable !== undefined
    ? [[`homie/${deviceId}/${nodeId}/${propertyId}/$settable`, String(options.settable)] as const]
    : []),
  ...(options.retained !== undefined
    ? [[`homie/${deviceId}/${nodeId}/${propertyId}/$retained`, String(options.retained)] as const]
    : []),
  ...(options.unit
    ? [[`homie/${deviceId}/${nodeId}/${propertyId}/$unit`, options.unit] as const]
    : []),
];

describe("Homie compatibility matrix", () => {
  it("maps every Homie v5 read-only datatype to a safe Home Assistant entity", () => {
    const bridge = new HomieHaDiscoveryBridge();
    const messages = publish(bridge, [
      [
        "homie/5/matrix/$description",
        JSON.stringify({
          homie: "5.0",
          version: 1,
          name: "Matrix",
          nodes: {
            readonly: {
              name: "Read Only",
              properties: {
                int: { datatype: "integer", format: "-10:10:1", unit: "#" },
                float: { datatype: "float", format: "-1.5:1.5:0.25", unit: "V" },
                bool: { datatype: "boolean", format: "closed,open", retained: false },
                text: { datatype: "string" },
                mode: { datatype: "enum", format: "auto,manual,,boost" },
                color: { datatype: "color", format: "rgb,hsv,xyz" },
                timestamp: { datatype: "datetime" },
                uptime: { datatype: "duration" },
                metadata: { datatype: "json" },
              },
            },
          },
        }),
      ],
    ]);
    const payload = getLatestDevicePayload(messages, "homie_homie_5_matrix");

    expect(getComponent(payload, "homie_homie_5_matrix_readonly_int")).toEqual(
      expect.objectContaining({
        platform: "sensor",
        state_class: "measurement",
        unit_of_measurement: "#",
      }),
    );
    expect(getComponent(payload, "homie_homie_5_matrix_readonly_float")).toEqual(
      expect.objectContaining({
        platform: "sensor",
        device_class: "voltage",
        state_class: "measurement",
        unit_of_measurement: "V",
      }),
    );
    expect(getComponent(payload, "homie_homie_5_matrix_readonly_bool")).toEqual(
      expect.objectContaining({
        platform: "binary_sensor",
        payload_off: "false",
        payload_on: "true",
        force_update: true,
      }),
    );
    expect(getComponent(payload, "homie_homie_5_matrix_readonly_text")).toEqual(
      expect.objectContaining({ platform: "sensor" }),
    );
    expect(getComponent(payload, "homie_homie_5_matrix_readonly_mode")).toEqual(
      expect.objectContaining({ platform: "sensor" }),
    );
    expect(getComponent(payload, "homie_homie_5_matrix_readonly_color")).toEqual(
      expect.objectContaining({ platform: "sensor" }),
    );
    expect(getComponent(payload, "homie_homie_5_matrix_readonly_timestamp")).toEqual(
      expect.objectContaining({ platform: "sensor", device_class: "timestamp" }),
    );
    expect(getComponent(payload, "homie_homie_5_matrix_readonly_uptime")).toEqual(
      expect.objectContaining({ platform: "sensor", device_class: "duration" }),
    );
    expect(getComponent(payload, "homie_homie_5_matrix_readonly_metadata")).toEqual(
      expect.objectContaining({
        platform: "sensor",
        value_template: "{{ 'json' }}",
        json_attributes_topic: "homie/5/matrix/readonly/metadata",
      }),
    );
  });

  it("maps every commandable Homie v5 datatype to a commandable Home Assistant entity", () => {
    const bridge = new HomieHaDiscoveryBridge();
    const messages = publish(bridge, [
      [
        "homie/5/controls/$description",
        JSON.stringify({
          homie: "5.0",
          version: 1,
          name: "Controls",
          nodes: {
            control: {
              properties: {
                int: { datatype: "integer", format: "-10:10:2", settable: true },
                float: { datatype: "float", format: "-1.5:1.5:0.25", settable: true },
                bool: { datatype: "boolean", format: "off,on", settable: true },
                mode: { datatype: "enum", format: "auto,manual,,boost", settable: true },
                emptyenum: { datatype: "enum", settable: true },
                text: { datatype: "string", settable: true },
                color: { datatype: "color", format: "rgb,hsv,xyz", settable: true },
                timestamp: { datatype: "datetime", settable: true },
                uptime: { datatype: "duration", settable: true },
                metadata: { datatype: "json", settable: true },
              },
            },
          },
        }),
      ],
    ]);
    const payload = getLatestDevicePayload(messages, "homie_homie_5_controls");

    expect(getComponent(payload, "homie_homie_5_controls_control_int")).toEqual(
      expect.objectContaining({
        platform: "number",
        command_topic: "homie/5/controls/control/int/set",
        min: -10,
        max: 10,
        step: 2,
      }),
    );
    expect(getComponent(payload, "homie_homie_5_controls_control_float")).toEqual(
      expect.objectContaining({
        platform: "number",
        command_topic: "homie/5/controls/control/float/set",
        min: -1.5,
        max: 1.5,
        step: 0.25,
      }),
    );
    expect(getComponent(payload, "homie_homie_5_controls_control_bool")).toEqual(
      expect.objectContaining({
        platform: "switch",
        command_topic: "homie/5/controls/control/bool/set",
        payload_off: "false",
        payload_on: "true",
      }),
    );
    expect(getComponent(payload, "homie_homie_5_controls_control_mode")).toEqual(
      expect.objectContaining({
        platform: "select",
        command_topic: "homie/5/controls/control/mode/set",
        options: ["auto", "manual,boost"],
      }),
    );
    expect(getComponent(payload, "homie_homie_5_controls_control_emptyenum")).toEqual(
      expect.objectContaining({
        platform: "text",
        command_topic: "homie/5/controls/control/emptyenum/set",
      }),
    );

    for (const propertyId of ["text", "color", "timestamp", "uptime", "metadata"]) {
      expect(getComponent(payload, `homie_homie_5_controls_control_${propertyId}`)).toEqual(
        expect.objectContaining({
          platform: "text",
          command_topic: `homie/5/controls/control/${propertyId}/set`,
        }),
      );
    }
  });

  it("maps every Homie v4 datatype and command flag combination supported by the spec", () => {
    const bridge = new HomieHaDiscoveryBridge();
    const messages = publish(bridge, [
      ...legacyPropertyMessages("legacy-matrix", "readonly", "int", "integer", { unit: "#" }),
      ...legacyPropertyMessages("legacy-matrix", "readonly", "float", "float", { unit: "A" }),
      ...legacyPropertyMessages("legacy-matrix", "readonly", "bool", "boolean", {
        format: "false,true",
      }),
      ...legacyPropertyMessages("legacy-matrix", "readonly", "text", "string"),
      ...legacyPropertyMessages("legacy-matrix", "readonly", "mode", "enum", {
        format: "auto,manual",
      }),
      ...legacyPropertyMessages("legacy-matrix", "readonly", "color", "color", {
        format: "rgb,hsv",
      }),
      ...legacyPropertyMessages("legacy-matrix", "control", "int", "integer", {
        format: "0:100:5",
        settable: true,
      }),
      ...legacyPropertyMessages("legacy-matrix", "control", "float", "float", {
        format: "-10:10:0.5",
        settable: true,
      }),
      ...legacyPropertyMessages("legacy-matrix", "control", "bool", "boolean", {
        settable: true,
      }),
      ...legacyPropertyMessages("legacy-matrix", "control", "text", "string", {
        settable: true,
      }),
      ...legacyPropertyMessages("legacy-matrix", "control", "mode", "enum", {
        format: "auto,manual",
        settable: true,
      }),
      ...legacyPropertyMessages("legacy-matrix", "control", "color", "color", {
        format: "rgb,hsv",
        settable: true,
      }),
      ["homie/legacy-matrix/readonly/$properties", "int,float,bool,text,mode,color"],
      ["homie/legacy-matrix/control/$properties", "int,float,bool,text,mode,color"],
      ["homie/legacy-matrix/$nodes", "readonly,control"],
      ["homie/legacy-matrix/$name", "Legacy Matrix"],
      ["homie/legacy-matrix/$extensions", ""],
      ["homie/legacy-matrix/$homie", "4.0.0"],
    ]);
    const payload = getLatestDevicePayload(messages, "homie_homie_legacy_matrix");

    expect(getComponent(payload, "homie_homie_legacy_matrix_readonly_int")).toEqual(
      expect.objectContaining({ platform: "sensor", unit_of_measurement: "#" }),
    );
    expect(getComponent(payload, "homie_homie_legacy_matrix_readonly_float")).toEqual(
      expect.objectContaining({
        platform: "sensor",
        device_class: "current",
        unit_of_measurement: "A",
      }),
    );
    expect(getComponent(payload, "homie_homie_legacy_matrix_readonly_bool")).toEqual(
      expect.objectContaining({ platform: "binary_sensor" }),
    );
    expect(getComponent(payload, "homie_homie_legacy_matrix_readonly_text")).toEqual(
      expect.objectContaining({ platform: "sensor" }),
    );
    expect(getComponent(payload, "homie_homie_legacy_matrix_readonly_mode")).toEqual(
      expect.objectContaining({ platform: "sensor" }),
    );
    expect(getComponent(payload, "homie_homie_legacy_matrix_readonly_color")).toEqual(
      expect.objectContaining({ platform: "sensor" }),
    );
    expect(getComponent(payload, "homie_homie_legacy_matrix_control_int")).toEqual(
      expect.objectContaining({ platform: "number", min: 0, max: 100, step: 5 }),
    );
    expect(getComponent(payload, "homie_homie_legacy_matrix_control_float")).toEqual(
      expect.objectContaining({ platform: "number", min: -10, max: 10, step: 0.5 }),
    );
    expect(getComponent(payload, "homie_homie_legacy_matrix_control_bool")).toEqual(
      expect.objectContaining({ platform: "switch" }),
    );
    expect(getComponent(payload, "homie_homie_legacy_matrix_control_text")).toEqual(
      expect.objectContaining({ platform: "text" }),
    );
    expect(getComponent(payload, "homie_homie_legacy_matrix_control_mode")).toEqual(
      expect.objectContaining({ platform: "select", options: ["auto", "manual"] }),
    );
    expect(getComponent(payload, "homie_homie_legacy_matrix_control_color")).toEqual(
      expect.objectContaining({ platform: "text" }),
    );
  });

  it("uses the Homie v3 implicit string datatype when legacy metadata omits datatype", () => {
    const bridge = new HomieHaDiscoveryBridge();
    const messages = publish(bridge, [
      ["homie/v3-display/$nodes", "display"],
      ["homie/v3-display/display/$properties", "label"],
      ["homie/v3-display/display/label/$name", "Label"],
      ["homie/v3-display/$homie", "3.0.1"],
    ]);
    const payload = getLatestDevicePayload(messages, "homie_homie_v3_display");

    expect(getComponent(payload, "homie_homie_v3_display_display_label")).toEqual(
      expect.objectContaining({
        platform: "sensor",
        name: "Label",
        state_topic: "homie/v3-display/display/label",
      }),
    );
  });

  it("applies compact named-node state overrides to retained Homie v4 metadata", () => {
    const bridge = new HomieHaDiscoveryBridge({
      overrides: {
        deviceDefaults: {
          objectId: "legacy_{deviceId}",
          identifiers: ["LEGACY_{deviceId}"],
        },
        namedNodeState: {
          exclusive: true,
          platform: "light",
          objectId: "legacy_{deviceId}_{nodeId}",
        },
        devices: {
          "legacy-relays": {
            name: "Legacy Relays",
            nodeNames: {
              "1": "Garage",
              "2": {
                name: "Extractor",
                platform: "fan",
              },
            },
          },
        },
      },
    });
    const messages = publish(bridge, [
      ...legacyPropertyMessages("legacy-relays", "1", "state", "boolean", { settable: true }),
      ...legacyPropertyMessages("legacy-relays", "2", "state", "boolean", { settable: true }),
      ...legacyPropertyMessages("legacy-relays", "99", "state", "boolean", { settable: true }),
      ["homie/legacy-relays/1/$properties", "state"],
      ["homie/legacy-relays/2/$properties", "state"],
      ["homie/legacy-relays/99/$properties", "state"],
      ["homie/legacy-relays/$nodes", "1,2,99"],
      ["homie/legacy-relays/$homie", "4.0.0"],
    ]);
    const payload = getLatestDevicePayload(messages, "legacy_legacy_relays");

    expect(payload.components).toEqual(
      expect.objectContaining({
        legacy_legacy_relays_1: expect.objectContaining({
          platform: "light",
          name: "Garage",
          command_topic: "homie/legacy-relays/1/state/set",
        }),
        legacy_legacy_relays_2: expect.objectContaining({
          platform: "fan",
          name: "Extractor",
          command_topic: "homie/legacy-relays/2/state/set",
        }),
      }),
    );
    expect(payload.components).not.toHaveProperty("legacy_legacy_relays_99_state");
  });
});
