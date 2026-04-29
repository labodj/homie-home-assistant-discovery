import type {
  DeviceDiscoveryDefaults,
  DeviceDiscoveryOverride,
  DiscoveryMappingRule,
  DiscoveryMappingRuleMatcher,
  DiscoveryOverrideConfig,
  HomeAssistantPlatform,
  HomieDatatype,
  HomieMajorVersion,
  NamedNodeStateOverride,
  NodeDiscoveryOverride,
  NodeNameStateOverride,
  PropertyDiscoveryOverride,
} from "./types";
import { isRecord } from "./utils";

const HOME_ASSISTANT_PLATFORMS = new Set<HomeAssistantPlatform>([
  "sensor",
  "binary_sensor",
  "switch",
  "light",
  "fan",
  "number",
  "select",
  "text",
]);

const ENTITY_CATEGORIES = new Set<PropertyDiscoveryOverride["entityCategory"]>([
  "diagnostic",
  "config",
]);

const STATE_CLASSES = new Set<PropertyDiscoveryOverride["stateClass"]>([
  "measurement",
  "total",
  "total_increasing",
]);

const HOMIE_DATATYPES = new Set<HomieDatatype>([
  "integer",
  "float",
  "boolean",
  "string",
  "enum",
  "color",
  "datetime",
  "duration",
  "json",
]);

const HOMIE_MAJOR_VERSIONS = new Set<HomieMajorVersion>([3, 4, 5]);

const DEVICE_FIELDS = new Set([
  "name",
  "objectId",
  "manufacturer",
  "model",
  "identifiers",
  "viaDevice",
  "nodeNames",
  "nodes",
  "properties",
]);

const DEVICE_DEFAULT_FIELDS = new Set([
  "name",
  "objectId",
  "manufacturer",
  "model",
  "identifiers",
  "viaDevice",
]);

const NODE_FIELDS = new Set(["name", "properties"]);

const MATCH_FIELDS = new Set([
  "baseTopic",
  "deviceId",
  "majorVersion",
  "nodeId",
  "propertyId",
  "path",
  "nodeName",
  "nodeType",
  "propertyName",
  "datatype",
  "settable",
  "retained",
  "unit",
  "configuredNode",
]);

const PROPERTY_FIELDS = new Set([
  "enabled",
  "platform",
  "name",
  "objectId",
  "defaultEntityId",
  "icon",
  "entityCategory",
  "deviceClass",
  "stateClass",
  "unit",
  "valueTemplate",
  "jsonAttributesTopic",
  "jsonAttributesTemplate",
  "stateTopic",
  "commandTopic",
  "payloadOn",
  "payloadOff",
  "forceUpdate",
  "enabledByDefault",
  "entityPicture",
  "expireAfter",
  "suggestedDisplayPrecision",
  "options",
  "min",
  "max",
  "step",
  "ha",
]);

const RULE_FIELDS = new Set(["match", ...PROPERTY_FIELDS]);

const NAMED_NODE_STATE_FIELDS = new Set(["exclusive", ...PROPERTY_FIELDS]);

const RESERVED_HA_CONFIG_FIELDS = new Set([
  "command_topic",
  "device",
  "device_class",
  "default_entity_id",
  "enabled_by_default",
  "entity_category",
  "entity_picture",
  "expire_after",
  "force_update",
  "icon",
  "json_attributes_template",
  "json_attributes_topic",
  "max",
  "min",
  "mode",
  "name",
  "object_id",
  "options",
  "origin",
  "payload_off",
  "payload_on",
  "platform",
  "state_class",
  "state_topic",
  "step",
  "suggested_display_precision",
  "unique_id",
  "unit_of_measurement",
  "value_template",
]);

const assertKnownFields = (
  value: Record<string, unknown>,
  allowedFields: ReadonlySet<string>,
  path: string,
): void => {
  for (const field of Object.keys(value)) {
    if (!allowedFields.has(field)) {
      throw new Error(`Unknown discovery override field '${path}.${field}'.`);
    }
  }
};

const assertRecord = (value: unknown, path: string): Record<string, unknown> => {
  if (!isRecord(value)) {
    throw new Error(`Discovery override '${path}' must be an object.`);
  }
  return value;
};

const assertString = (value: unknown, path: string): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Discovery override '${path}' must be a non-empty string.`);
  }
  return value;
};

const assertStringArray = (value: unknown, path: string): string[] => {
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== "string" || entry.length === 0)
  ) {
    throw new Error(`Discovery override '${path}' must be an array of non-empty strings.`);
  }
  return value as string[];
};

const assertStringOrStringArray = (value: unknown, path: string): string | string[] =>
  Array.isArray(value) ? assertStringArray(value, path) : assertString(value, path);

const assertBoolean = (value: unknown, path: string): boolean => {
  if (typeof value !== "boolean") {
    throw new Error(`Discovery override '${path}' must be a boolean.`);
  }
  return value;
};

const assertFiniteNumber = (value: unknown, path: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Discovery override '${path}' must be a finite number.`);
  }
  return value;
};

const assertPositiveFiniteNumber = (value: unknown, path: string): number => {
  const number = assertFiniteNumber(value, path);
  if (number <= 0) {
    throw new Error(`Discovery override '${path}' must be greater than zero.`);
  }
  return number;
};

const assertNonNegativeInteger = (value: unknown, path: string): number => {
  const number = assertFiniteNumber(value, path);
  if (!Number.isInteger(number) || number < 0) {
    throw new Error(`Discovery override '${path}' must be a non-negative integer.`);
  }
  return number;
};

const assertJsonValue = (value: unknown, path: string): unknown => {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry, index) => assertJsonValue(entry, `${path}.${index}`));
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        assertString(key, `${path} key`),
        assertJsonValue(entry, `${path}.${key}`),
      ]),
    );
  }

  throw new Error(`Discovery override '${path}' must be valid JSON data.`);
};

const assertHaConfigPatch = (value: unknown, path: string): Record<string, unknown> => {
  const record = assertRecord(value, path);
  for (const key of Object.keys(record)) {
    if (RESERVED_HA_CONFIG_FIELDS.has(key)) {
      throw new Error(
        `Discovery override '${path}.${key}' is managed by the mapper; use the typed override field instead.`,
      );
    }
  }
  return assertJsonValue(record, path) as Record<string, unknown>;
};

const assertPlatform = (value: unknown, path: string): HomeAssistantPlatform => {
  if (typeof value !== "string" || !HOME_ASSISTANT_PLATFORMS.has(value as HomeAssistantPlatform)) {
    throw new Error(`Discovery override '${path}' must be a supported Home Assistant platform.`);
  }
  return value as HomeAssistantPlatform;
};

const assertHomieDatatype = (value: unknown, path: string): HomieDatatype => {
  if (typeof value !== "string" || !HOMIE_DATATYPES.has(value as HomieDatatype)) {
    throw new Error(`Discovery override '${path}' must be a supported Homie datatype.`);
  }
  return value as HomieDatatype;
};

const assertHomieDatatypeOrArray = (
  value: unknown,
  path: string,
): HomieDatatype | HomieDatatype[] => {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      throw new Error(`Discovery override '${path}' must not be an empty array.`);
    }
    return value.map((entry, index) => assertHomieDatatype(entry, `${path}.${index}`));
  }
  return assertHomieDatatype(value, path);
};

const assertHomieMajorVersion = (value: unknown, path: string): HomieMajorVersion => {
  if (typeof value !== "number" || !HOMIE_MAJOR_VERSIONS.has(value as HomieMajorVersion)) {
    throw new Error(`Discovery override '${path}' must be Homie major version 3, 4 or 5.`);
  }
  return value as HomieMajorVersion;
};

const assertHomieMajorVersionOrArray = (
  value: unknown,
  path: string,
): HomieMajorVersion | HomieMajorVersion[] => {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      throw new Error(`Discovery override '${path}' must not be an empty array.`);
    }
    return value.map((entry, index) => assertHomieMajorVersion(entry, `${path}.${index}`));
  }
  return assertHomieMajorVersion(value, path);
};

const assertEntityCategory = (
  value: unknown,
  path: string,
): PropertyDiscoveryOverride["entityCategory"] => {
  if (
    typeof value !== "string" ||
    !ENTITY_CATEGORIES.has(value as PropertyDiscoveryOverride["entityCategory"])
  ) {
    throw new Error(`Discovery override '${path}' must be diagnostic or config.`);
  }
  return value as PropertyDiscoveryOverride["entityCategory"];
};

const assertStateClass = (
  value: unknown,
  path: string,
): PropertyDiscoveryOverride["stateClass"] => {
  if (
    typeof value !== "string" ||
    !STATE_CLASSES.has(value as PropertyDiscoveryOverride["stateClass"])
  ) {
    throw new Error(`Discovery override '${path}' must be measurement, total or total_increasing.`);
  }
  return value as PropertyDiscoveryOverride["stateClass"];
};

const validatePropertyOverride = (value: unknown, path: string): PropertyDiscoveryOverride => {
  const record = assertRecord(value, path);
  assertKnownFields(record, PROPERTY_FIELDS, path);

  const override: PropertyDiscoveryOverride = {};
  if (record.enabled !== undefined)
    override.enabled = assertBoolean(record.enabled, `${path}.enabled`);
  if (record.platform !== undefined)
    override.platform = assertPlatform(record.platform, `${path}.platform`);
  if (record.name !== undefined) override.name = assertString(record.name, `${path}.name`);
  if (record.objectId !== undefined)
    override.objectId = assertString(record.objectId, `${path}.objectId`);
  if (record.defaultEntityId !== undefined) {
    override.defaultEntityId = assertString(record.defaultEntityId, `${path}.defaultEntityId`);
  }
  if (record.icon !== undefined) override.icon = assertString(record.icon, `${path}.icon`);
  if (record.entityCategory !== undefined) {
    override.entityCategory = assertEntityCategory(record.entityCategory, `${path}.entityCategory`);
  }
  if (record.deviceClass !== undefined) {
    override.deviceClass = assertString(record.deviceClass, `${path}.deviceClass`);
  }
  if (record.stateClass !== undefined)
    override.stateClass = assertStateClass(record.stateClass, `${path}.stateClass`);
  if (record.unit !== undefined) override.unit = assertString(record.unit, `${path}.unit`);
  if (record.valueTemplate !== undefined) {
    override.valueTemplate = assertString(record.valueTemplate, `${path}.valueTemplate`);
  }
  if (record.jsonAttributesTopic !== undefined) {
    override.jsonAttributesTopic = assertString(
      record.jsonAttributesTopic,
      `${path}.jsonAttributesTopic`,
    );
  }
  if (record.jsonAttributesTemplate !== undefined) {
    override.jsonAttributesTemplate = assertString(
      record.jsonAttributesTemplate,
      `${path}.jsonAttributesTemplate`,
    );
  }
  if (record.stateTopic !== undefined)
    override.stateTopic = assertString(record.stateTopic, `${path}.stateTopic`);
  if (record.commandTopic !== undefined) {
    override.commandTopic = assertString(record.commandTopic, `${path}.commandTopic`);
  }
  if (record.payloadOn !== undefined)
    override.payloadOn = assertString(record.payloadOn, `${path}.payloadOn`);
  if (record.payloadOff !== undefined)
    override.payloadOff = assertString(record.payloadOff, `${path}.payloadOff`);
  if (record.forceUpdate !== undefined) {
    override.forceUpdate = assertBoolean(record.forceUpdate, `${path}.forceUpdate`);
  }
  if (record.enabledByDefault !== undefined) {
    override.enabledByDefault = assertBoolean(record.enabledByDefault, `${path}.enabledByDefault`);
  }
  if (record.entityPicture !== undefined) {
    override.entityPicture = assertString(record.entityPicture, `${path}.entityPicture`);
  }
  if (record.expireAfter !== undefined) {
    override.expireAfter = assertPositiveFiniteNumber(record.expireAfter, `${path}.expireAfter`);
  }
  if (record.suggestedDisplayPrecision !== undefined) {
    override.suggestedDisplayPrecision = assertNonNegativeInteger(
      record.suggestedDisplayPrecision,
      `${path}.suggestedDisplayPrecision`,
    );
  }
  if (record.options !== undefined)
    override.options = assertStringArray(record.options, `${path}.options`);
  if (record.min !== undefined) override.min = assertFiniteNumber(record.min, `${path}.min`);
  if (record.max !== undefined) override.max = assertFiniteNumber(record.max, `${path}.max`);
  if (record.step !== undefined)
    override.step = assertPositiveFiniteNumber(record.step, `${path}.step`);
  if (override.min !== undefined && override.max !== undefined && override.max < override.min) {
    throw new Error(`Discovery override '${path}.max' must be greater than or equal to min.`);
  }
  if (record.ha !== undefined) override.ha = assertHaConfigPatch(record.ha, `${path}.ha`);

  return override;
};

const validateMappingRuleMatcher = (value: unknown, path: string): DiscoveryMappingRuleMatcher => {
  const record = assertRecord(value, path);
  assertKnownFields(record, MATCH_FIELDS, path);
  if (Object.keys(record).length === 0) {
    throw new Error(`Discovery override '${path}' must contain at least one matcher.`);
  }

  const match: DiscoveryMappingRuleMatcher = {};
  if (record.baseTopic !== undefined)
    match.baseTopic = assertStringOrStringArray(record.baseTopic, `${path}.baseTopic`);
  if (record.deviceId !== undefined)
    match.deviceId = assertStringOrStringArray(record.deviceId, `${path}.deviceId`);
  if (record.majorVersion !== undefined) {
    match.majorVersion = assertHomieMajorVersionOrArray(
      record.majorVersion,
      `${path}.majorVersion`,
    );
  }
  if (record.nodeId !== undefined)
    match.nodeId = assertStringOrStringArray(record.nodeId, `${path}.nodeId`);
  if (record.propertyId !== undefined)
    match.propertyId = assertStringOrStringArray(record.propertyId, `${path}.propertyId`);
  if (record.path !== undefined)
    match.path = assertStringOrStringArray(record.path, `${path}.path`);
  if (record.nodeName !== undefined)
    match.nodeName = assertStringOrStringArray(record.nodeName, `${path}.nodeName`);
  if (record.nodeType !== undefined)
    match.nodeType = assertStringOrStringArray(record.nodeType, `${path}.nodeType`);
  if (record.propertyName !== undefined)
    match.propertyName = assertStringOrStringArray(record.propertyName, `${path}.propertyName`);
  if (record.datatype !== undefined) {
    match.datatype = assertHomieDatatypeOrArray(record.datatype, `${path}.datatype`);
  }
  if (record.settable !== undefined)
    match.settable = assertBoolean(record.settable, `${path}.settable`);
  if (record.retained !== undefined)
    match.retained = assertBoolean(record.retained, `${path}.retained`);
  if (record.unit !== undefined)
    match.unit = assertStringOrStringArray(record.unit, `${path}.unit`);
  if (record.configuredNode !== undefined) {
    match.configuredNode = assertBoolean(record.configuredNode, `${path}.configuredNode`);
  }

  return match;
};

const validateMappingRule = (value: unknown, path: string): DiscoveryMappingRule => {
  const record = assertRecord(value, path);
  assertKnownFields(record, RULE_FIELDS, path);
  if (record.match === undefined) {
    throw new Error(`Discovery override '${path}.match' is required.`);
  }
  const propertyRecord = { ...record };
  delete propertyRecord.match;
  if (Object.keys(propertyRecord).length === 0) {
    throw new Error(`Discovery override '${path}' must contain at least one override field.`);
  }

  return {
    ...validatePropertyOverride(propertyRecord, path),
    match: validateMappingRuleMatcher(record.match, `${path}.match`),
  };
};

const validateMappingRuleArray = (value: unknown, path: string): DiscoveryMappingRule[] => {
  if (!Array.isArray(value)) {
    throw new Error(`Discovery override '${path}' must be an array.`);
  }

  return value.map((entry, index) => validateMappingRule(entry, `${path}.${index}`));
};

const validatePropertyOverrideMap = (
  value: unknown,
  path: string,
): Record<string, PropertyDiscoveryOverride> => {
  const record = assertRecord(value, path);
  return Object.fromEntries(
    Object.entries(record).map(([key, override]) => [
      assertString(key, `${path} key`),
      validatePropertyOverride(override, `${path}.${key}`),
    ]),
  );
};

const validateNodeOverride = (value: unknown, path: string): NodeDiscoveryOverride => {
  const record = assertRecord(value, path);
  assertKnownFields(record, NODE_FIELDS, path);

  const override: NodeDiscoveryOverride = {};
  if (record.name !== undefined) override.name = assertString(record.name, `${path}.name`);
  if (record.properties !== undefined) {
    override.properties = validatePropertyOverrideMap(record.properties, `${path}.properties`);
  }
  return override;
};

const validateNodeOverrideMap = (
  value: unknown,
  path: string,
): Record<string, NodeDiscoveryOverride> => {
  const record = assertRecord(value, path);
  return Object.fromEntries(
    Object.entries(record).map(([key, override]) => [
      assertString(key, `${path} key`),
      validateNodeOverride(override, `${path}.${key}`),
    ]),
  );
};

const validateNodeNameStateOverride = (value: unknown, path: string): NodeNameStateOverride => {
  const override = validatePropertyOverride(value, path);
  if (!override.name) {
    throw new Error(`Discovery override '${path}.name' is required.`);
  }
  return override as NodeNameStateOverride;
};

const validateNodeNameMap = (
  value: unknown,
  path: string,
): {
  nodeNames: Record<string, string>;
  stateOverrides: Record<string, NodeNameStateOverride>;
} => {
  const record = assertRecord(value, path);
  const nodeNames: Record<string, string> = {};
  const stateOverrides: Record<string, NodeNameStateOverride> = {};
  for (const [key, value] of Object.entries(record)) {
    const nodeId = assertString(key, `${path} key`);
    if (typeof value === "string") {
      nodeNames[nodeId] = assertString(value, `${path}.${nodeId}`);
      continue;
    }

    const stateOverride = validateNodeNameStateOverride(value, `${path}.${nodeId}`);
    nodeNames[nodeId] = stateOverride.name;
    stateOverrides[nodeId] = stateOverride;
  }
  return { nodeNames, stateOverrides };
};

// `nodeNames` is stored in a compact form for documentation and diagnostics,
// but it is also expanded into normal node/property overrides. The mapper can
// therefore resolve names and exact state exceptions through the same path used
// by advanced configurations.
const mergeNodeNamesIntoNodes = (
  nodeNames: Record<string, string> | undefined,
  nodes: Record<string, NodeDiscoveryOverride> | undefined,
  stateOverrides: Record<string, NodeNameStateOverride> | undefined,
): Record<string, NodeDiscoveryOverride> | undefined => {
  if (!nodeNames) {
    return nodes;
  }

  const mergedNodes: Record<string, NodeDiscoveryOverride> = {};
  for (const [nodeId, name] of Object.entries(nodeNames)) {
    const stateOverride = stateOverrides?.[nodeId];
    mergedNodes[nodeId] = {
      name,
      ...(stateOverride ? { properties: { state: stateOverride } } : {}),
    };
  }
  for (const [nodeId, nodeOverride] of Object.entries(nodes ?? {})) {
    const properties = {
      ...mergedNodes[nodeId]?.properties,
      ...nodeOverride.properties,
    };
    mergedNodes[nodeId] = {
      ...mergedNodes[nodeId],
      ...nodeOverride,
      ...(Object.keys(properties).length > 0 ? { properties } : {}),
    };
  }
  return mergedNodes;
};

const validateNamedNodeStateOverride = (value: unknown, path: string): NamedNodeStateOverride => {
  const record = assertRecord(value, path);
  assertKnownFields(record, NAMED_NODE_STATE_FIELDS, path);
  const propertyOverride = validatePropertyOverride(
    Object.fromEntries(Object.entries(record).filter(([key]) => key !== "exclusive")),
    path,
  );
  return {
    ...propertyOverride,
    ...(record.exclusive !== undefined
      ? { exclusive: assertBoolean(record.exclusive, `${path}.exclusive`) }
      : {}),
  };
};

const validateDeviceDefaults = (value: unknown, path: string): DeviceDiscoveryDefaults => {
  const record = assertRecord(value, path);
  assertKnownFields(record, DEVICE_DEFAULT_FIELDS, path);

  const defaults: DeviceDiscoveryDefaults = {};
  if (record.name !== undefined) defaults.name = assertString(record.name, `${path}.name`);
  if (record.objectId !== undefined)
    defaults.objectId = assertString(record.objectId, `${path}.objectId`);
  if (record.manufacturer !== undefined) {
    defaults.manufacturer = assertString(record.manufacturer, `${path}.manufacturer`);
  }
  if (record.model !== undefined) defaults.model = assertString(record.model, `${path}.model`);
  if (record.identifiers !== undefined) {
    defaults.identifiers = assertStringArray(record.identifiers, `${path}.identifiers`);
  }
  if (record.viaDevice !== undefined) {
    defaults.viaDevice = assertString(record.viaDevice, `${path}.viaDevice`);
  }

  return defaults;
};

const validateDeviceOverride = (value: unknown, path: string): DeviceDiscoveryOverride => {
  const record = assertRecord(value, path);
  assertKnownFields(record, DEVICE_FIELDS, path);

  const override: DeviceDiscoveryOverride = {};
  if (record.name !== undefined) override.name = assertString(record.name, `${path}.name`);
  if (record.objectId !== undefined)
    override.objectId = assertString(record.objectId, `${path}.objectId`);
  if (record.manufacturer !== undefined) {
    override.manufacturer = assertString(record.manufacturer, `${path}.manufacturer`);
  }
  if (record.model !== undefined) override.model = assertString(record.model, `${path}.model`);
  if (record.identifiers !== undefined) {
    override.identifiers = assertStringArray(record.identifiers, `${path}.identifiers`);
  }
  if (record.viaDevice !== undefined) {
    override.viaDevice = assertString(record.viaDevice, `${path}.viaDevice`);
  }
  let nodeNames: Record<string, string> | undefined;
  let stateOverrides: Record<string, NodeNameStateOverride> | undefined;
  if (record.nodeNames !== undefined) {
    const validatedNodeNames = validateNodeNameMap(record.nodeNames, `${path}.nodeNames`);
    nodeNames = validatedNodeNames.nodeNames;
    stateOverrides = validatedNodeNames.stateOverrides;
    override.nodeNames = nodeNames;
  }
  if (record.nodes !== undefined) {
    override.nodes = validateNodeOverrideMap(record.nodes, `${path}.nodes`);
  }
  override.nodes = mergeNodeNamesIntoNodes(nodeNames, override.nodes, stateOverrides);
  if (record.properties !== undefined) {
    override.properties = validatePropertyOverrideMap(record.properties, `${path}.properties`);
  }

  return override;
};

export const validateDiscoveryOverrides = (value: unknown): DiscoveryOverrideConfig => {
  const record = assertRecord(value, "overrides");
  assertKnownFields(
    record,
    new Set(["deviceDefaults", "namedNodeState", "devices", "rules"]),
    "overrides",
  );

  const overrides: DiscoveryOverrideConfig = {};
  if (record.deviceDefaults !== undefined) {
    overrides.deviceDefaults = validateDeviceDefaults(
      record.deviceDefaults,
      "overrides.deviceDefaults",
    );
  }
  if (record.namedNodeState !== undefined) {
    overrides.namedNodeState = validateNamedNodeStateOverride(
      record.namedNodeState,
      "overrides.namedNodeState",
    );
  }
  if (record.devices !== undefined) {
    const devices = assertRecord(record.devices, "overrides.devices");
    overrides.devices = Object.fromEntries(
      Object.entries(devices).map(([key, override]) => [
        assertString(key, "overrides.devices key"),
        validateDeviceOverride(override, `overrides.devices.${key}`),
      ]),
    );
  }
  if (record.rules !== undefined) {
    overrides.rules = validateMappingRuleArray(record.rules, "overrides.rules");
  }

  return overrides;
};
