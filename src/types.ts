export type HomieMajorVersion = 3 | 4 | 5;

export type HomieDatatype =
  "integer" | "float" | "boolean" | "string" | "enum" | "color" | "datetime" | "duration" | "json";

export type HomeAssistantPlatform =
  "sensor" | "binary_sensor" | "switch" | "light" | "fan" | "number" | "select" | "text";

export type CommandableBooleanPlatform = Extract<HomeAssistantPlatform, "switch" | "light" | "fan">;
export type CommandableBooleanPlatformMode = CommandableBooleanPlatform | "auto";

/** MQTT message shape accepted by the stateless ingestion API. */
export interface MqttMessageInput {
  topic: string;
  payload: string | Buffer | Uint8Array;
  retain?: boolean;
}

/** Retained Home Assistant MQTT discovery message that callers must publish. */
export interface DiscoveryMessage {
  topic: string;
  payload: Record<string, unknown> | "";
  qos: 0 | 1 | 2;
  retain: boolean;
}

/** Result of processing a Homie MQTT metadata message. */
export interface IngestResult {
  messages: DiscoveryMessage[];
  warnings: string[];
  logs: string[];
}

export interface HomeAssistantOrigin {
  name: string;
  sw_version?: string;
  support_url?: string;
}

export type DiscoveryCategory = "diagnostic" | "config";
export type StateClass = "measurement" | "total" | "total_increasing";
export type StringMatcher = string | string[];
export type HomieDatatypeMatcher = HomieDatatype | HomieDatatype[];
export type HomieMajorVersionMatcher = HomieMajorVersion | HomieMajorVersion[];

export interface DiscoveryOverrideConfig {
  deviceDefaults?: DeviceDiscoveryDefaults;
  namedNodeState?: NamedNodeStateOverride;
  devices?: Record<string, DeviceDiscoveryOverride>;
  rules?: DiscoveryMappingRule[];
}

/** Device fields applied before exact per-device overrides. String values support templates. */
export interface DeviceDiscoveryDefaults {
  name?: string;
  objectId?: string;
  manufacturer?: string;
  model?: string;
  identifiers?: string[];
  viaDevice?: string;
}

/** Device-level Home Assistant overrides keyed by Homie base topic or device id. */
export interface DeviceDiscoveryOverride extends DeviceDiscoveryDefaults {
  nodeNames?: Record<string, NodeNameOverride>;
  nodes?: Record<string, NodeDiscoveryOverride>;
  properties?: Record<string, PropertyDiscoveryOverride>;
}

export type NodeNameOverride = string | NodeNameStateOverride;

/** Compact node entry that names the node and optionally overrides its `state` entity. */
export interface NodeNameStateOverride extends PropertyDiscoveryOverride {
  name: string;
}

/** Shortcut applied to the settable boolean `state` property of named nodes. */
export interface NamedNodeStateOverride extends PropertyDiscoveryOverride {
  exclusive?: boolean;
}

/** Node-level defaults used while building property entity names. */
export interface NodeDiscoveryOverride {
  name?: string;
  properties?: Record<string, PropertyDiscoveryOverride>;
}

/** Property-level controls for platform, naming, command payload and HA metadata. */
export interface PropertyDiscoveryOverride {
  enabled?: boolean;
  platform?: HomeAssistantPlatform;
  name?: string;
  objectId?: string;
  defaultEntityId?: string;
  icon?: string;
  entityCategory?: DiscoveryCategory;
  deviceClass?: string;
  stateClass?: StateClass;
  unit?: string;
  valueTemplate?: string;
  jsonAttributesTopic?: string;
  jsonAttributesTemplate?: string;
  stateTopic?: string;
  commandTopic?: string;
  payloadOn?: string;
  payloadOff?: string;
  forceUpdate?: boolean;
  enabledByDefault?: boolean;
  entityPicture?: string;
  expireAfter?: number;
  suggestedDisplayPrecision?: number;
  options?: string[];
  min?: number;
  max?: number;
  step?: number;
  /**
   * Advanced Home Assistant MQTT discovery fields applied to the generated
   * component. Managed identity, platform and topic fields are intentionally
   * rejected by validation so discovery cleanup remains deterministic.
   */
  ha?: Record<string, unknown>;
}

/** Ordered property override rule used for pattern-based entity mapping. */
export interface DiscoveryMappingRule extends PropertyDiscoveryOverride {
  match: DiscoveryMappingRuleMatcher;
}

/** All provided fields must match. String values support `*` and `?` globs. */
export interface DiscoveryMappingRuleMatcher {
  baseTopic?: StringMatcher;
  deviceId?: StringMatcher;
  majorVersion?: HomieMajorVersionMatcher;
  nodeId?: StringMatcher;
  propertyId?: StringMatcher;
  path?: StringMatcher;
  nodeName?: StringMatcher;
  nodeType?: StringMatcher;
  propertyName?: StringMatcher;
  datatype?: HomieDatatypeMatcher;
  settable?: boolean;
  retained?: boolean;
  unit?: StringMatcher;
  configuredNode?: boolean;
}

/** Runtime options shared by the standalone library, MQTT daemon and Node-RED node. */
export interface HomieHaDiscoveryOptions {
  discoveryPrefix?: string;
  homieDomain?: string;
  legacyRoot?: string;
  enabledVersions?: HomieMajorVersion[];
  idPrefix?: string;
  manufacturer?: string;
  model?: string;
  origin?: HomeAssistantOrigin;
  includeStateSensor?: boolean;
  includeAttributeDiagnostics?: boolean;
  defaultCommandableBooleanPlatform?: CommandableBooleanPlatformMode;
  overrides?: DiscoveryOverrideConfig;
}

/** Version-neutral property model consumed by the Home Assistant mapper. */
export interface NormalizedHomieProperty {
  deviceId: string;
  nodeId: string;
  propertyId: string;
  objectId?: string;
  majorVersion: HomieMajorVersion;
  baseTopic: string;
  stateTopic: string;
  commandTopic: string;
  nodeName?: string;
  nodeType?: string;
  propertyName?: string;
  datatype: HomieDatatype;
  format?: string;
  settable: boolean;
  retained: boolean;
  unit?: string;
  entityCategory?: DiscoveryCategory;
  deviceClass?: string;
  stateClass?: StateClass;
  icon?: string;
  valueTemplate?: string;
  jsonAttributesTopic?: string;
  inferStateClass?: boolean;
}

/** Version-neutral device model produced by Homie parsers and legacy collectors. */
export interface NormalizedHomieDevice {
  deviceId: string;
  majorVersion: HomieMajorVersion;
  baseTopic: string;
  name?: string;
  type?: string;
  root?: string;
  parent?: string;
  version?: number;
  extensions?: string[];
  firmwareName?: string;
  swVersion?: string;
  mac?: string;
  properties: NormalizedHomieProperty[];
}
