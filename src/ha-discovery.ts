import type {
  DiscoveryMessage,
  DiscoveryCategory,
  CommandableBooleanPlatform,
  DeviceDiscoveryOverride,
  DiscoveryMappingRule,
  DiscoveryMappingRuleMatcher,
  HomeAssistantOrigin,
  HomeAssistantPlatform,
  HomieHaDiscoveryOptions,
  NormalizedHomieDevice,
  NormalizedHomieProperty,
  PropertyDiscoveryOverride,
} from "./types";
import { validateDiscoveryOverrides } from "./overrides";
import { toObjectIdSegment } from "./utils";
import { PACKAGE_VERSION } from "./version";

interface ResolvedDiscoveryOptions {
  discoveryPrefix: string;
  idPrefix: string;
  manufacturer: string;
  model: string;
  origin: HomeAssistantOrigin;
  includeStateSensor: boolean;
  includeAttributeDiagnostics: boolean;
  defaultCommandableBooleanPlatform: HomieHaDiscoveryOptions["defaultCommandableBooleanPlatform"];
  overrides?: HomieHaDiscoveryOptions["overrides"];
}

interface HomeAssistantDevice {
  identifiers: string[];
  name: string;
  manufacturer: string;
  model: string;
  via_device?: string;
  sw_version?: string;
  connections?: Array<[string, string]>;
}

interface DiscoveryComponentBase {
  platform: HomeAssistantPlatform;
  name: string;
  unique_id: string;
  default_entity_id: string;
  state_topic: string;
  entity_category?: DiscoveryCategory | "config";
  device_class?: string;
  unit_of_measurement?: string;
  state_class?: "measurement" | "total" | "total_increasing";
  force_update?: boolean;
  value_template?: string;
  json_attributes_topic?: string;
  json_attributes_template?: string;
  icon?: string;
  enabled_by_default?: boolean;
  entity_picture?: string;
  expire_after?: number;
  suggested_display_precision?: number;
}

interface CommandableComponent extends DiscoveryComponentBase {
  command_topic: string;
}

interface ToggleComponent extends CommandableComponent {
  platform: "switch" | "light" | "fan";
  payload_on: string;
  payload_off: string;
}

interface BinarySensorComponent extends DiscoveryComponentBase {
  platform: "binary_sensor";
  payload_on: string;
  payload_off: string;
}

interface NumberComponent extends CommandableComponent {
  platform: "number";
  mode: "box";
  min?: number;
  max?: number;
  step?: number;
}

interface SelectComponent extends CommandableComponent {
  platform: "select";
  options: string[];
}

interface TextComponent extends CommandableComponent {
  platform: "text";
  mode: "text";
}

type DiscoveryComponent =
  | DiscoveryComponentBase
  | ToggleComponent
  | BinarySensorComponent
  | NumberComponent
  | SelectComponent
  | TextComponent;

type RemovedDiscoveryComponent = Pick<DiscoveryComponentBase, "platform">;
type DiscoveryComponentUpdate = DiscoveryComponent | RemovedDiscoveryComponent;

interface DeviceDiscoveryPayload {
  device: HomeAssistantDevice;
  origin: HomeAssistantOrigin;
  availability_topic: string;
  availability_template: string;
  payload_available: "online";
  payload_not_available: "offline";
  qos: 1;
  components: Record<string, DiscoveryComponentUpdate>;
}

interface StateSensorPayload {
  name: string;
  unique_id: string;
  default_entity_id: string;
  state_topic: string;
  icon: string;
  entity_category: DiscoveryCategory;
  device: HomeAssistantDevice;
  origin: HomeAssistantOrigin;
}

interface ComponentEntry {
  id: string;
  platform: HomeAssistantPlatform;
  config: DiscoveryComponent;
}

export interface DiscoveryBuildResult {
  messages: DiscoveryMessage[];
  componentPlatforms: Record<string, HomeAssistantPlatform>;
  signature: string;
}

type TemplateContext = Record<string, string | number | undefined>;

export const resolveDiscoveryOptions = (
  options: HomieHaDiscoveryOptions,
): ResolvedDiscoveryOptions => ({
  discoveryPrefix: options.discoveryPrefix ?? "homeassistant",
  idPrefix: options.idPrefix ?? "homie",
  manufacturer: options.manufacturer ?? "Homie",
  model: options.model ?? "Homie MQTT Device",
  origin: options.origin ?? {
    name: "homie-home-assistant-discovery",
    sw_version: PACKAGE_VERSION,
    support_url: "https://github.com/labodj/homie-home-assistant-discovery",
  },
  includeStateSensor: options.includeStateSensor ?? true,
  includeAttributeDiagnostics: options.includeAttributeDiagnostics ?? true,
  defaultCommandableBooleanPlatform: options.defaultCommandableBooleanPlatform ?? "auto",
  // Normalize caller-provided overrides once at the API boundary. This keeps the
  // mapper code working with one canonical shape, regardless of whether the
  // user used compact shortcuts or fully expanded exact overrides.
  overrides: options.overrides ? validateDiscoveryOverrides(options.overrides) : undefined,
});

const createDeviceTemplateContext = (
  device: Pick<NormalizedHomieDevice, "baseTopic" | "deviceId"> & { majorVersion?: number },
): TemplateContext => {
  const topicParts = device.baseTopic.split("/");
  const versionSegment = topicParts.at(-2);
  const parsedMajorVersion = versionSegment ? Number.parseInt(versionSegment, 10) : undefined;
  const root = topicParts.slice(0, -2).join("/");
  return {
    baseTopic: device.baseTopic,
    deviceId: device.deviceId,
    majorVersion: device.majorVersion ?? parsedMajorVersion,
    root,
    rootSlug: toObjectIdSegment(root),
  };
};

const createPropertyTemplateContext = (
  device: NormalizedHomieDevice,
  property: NormalizedHomieProperty,
  extra: {
    deviceObjectId?: string;
    platform?: HomeAssistantPlatform;
    entityObjectId?: string;
  } = {},
): TemplateContext => ({
  ...createDeviceTemplateContext(device),
  nodeId: property.nodeId,
  propertyId: property.propertyId,
  path: `${property.nodeId}/${property.propertyId}`,
  nodeName: property.nodeName,
  nodeType: property.nodeType,
  propertyName: property.propertyName,
  deviceObjectId: extra.deviceObjectId,
  platform: extra.platform,
  entityObjectId: extra.entityObjectId,
  objectId: extra.entityObjectId,
});

// Templates deliberately use a small token language instead of executing user
// expressions. Unknown tokens are left intact so future versions can add tokens
// without making existing config files fail validation.
const renderTemplate = (value: string, context: TemplateContext): string =>
  value.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (match, token: string) => {
    const replacement = context[token];
    return replacement === undefined ? match : String(replacement);
  });

const renderOptionalTemplate = (
  value: string | undefined,
  context: TemplateContext,
): string | undefined => (value === undefined ? undefined : renderTemplate(value, context));

const renderTemplateArray = (value: string[], context: TemplateContext): string[] =>
  value.map((entry) => renderTemplate(entry, context));

const renderJsonTemplates = (value: unknown, context: TemplateContext): unknown => {
  if (typeof value === "string") {
    return renderTemplate(value, context);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => renderJsonTemplates(entry, context));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, renderJsonTemplates(entry, context)]),
    );
  }
  return value;
};

// The `ha` escape hatch can contain nested Home Assistant MQTT fields such as
// availability arrays. Rendering recursively lets compact fleet configs keep
// those advanced fields deterministic without hard-coding every HA option.
const renderPropertyOverride = (
  override: PropertyDiscoveryOverride | undefined,
  context: TemplateContext,
): PropertyDiscoveryOverride | undefined => {
  if (!override) {
    return undefined;
  }

  return {
    ...override,
    name: renderOptionalTemplate(override.name, context),
    objectId: renderOptionalTemplate(override.objectId, context),
    defaultEntityId: renderOptionalTemplate(override.defaultEntityId, context),
    icon: renderOptionalTemplate(override.icon, context),
    deviceClass: renderOptionalTemplate(override.deviceClass, context),
    unit: renderOptionalTemplate(override.unit, context),
    valueTemplate: renderOptionalTemplate(override.valueTemplate, context),
    jsonAttributesTopic: renderOptionalTemplate(override.jsonAttributesTopic, context),
    jsonAttributesTemplate: renderOptionalTemplate(override.jsonAttributesTemplate, context),
    stateTopic: renderOptionalTemplate(override.stateTopic, context),
    commandTopic: renderOptionalTemplate(override.commandTopic, context),
    payloadOn: renderOptionalTemplate(override.payloadOn, context),
    payloadOff: renderOptionalTemplate(override.payloadOff, context),
    entityPicture: renderOptionalTemplate(override.entityPicture, context),
    options: override.options ? renderTemplateArray(override.options, context) : undefined,
    ha: override.ha
      ? (renderJsonTemplates(override.ha, context) as Record<string, unknown>)
      : undefined,
  };
};

const getExactDeviceOverride = (
  device: NormalizedHomieDevice,
  options: ResolvedDiscoveryOptions,
): DeviceDiscoveryOverride | undefined =>
  options.overrides?.devices?.[device.baseTopic] ?? options.overrides?.devices?.[device.deviceId];

const getDeviceOverride = (
  device: NormalizedHomieDevice,
  options: ResolvedDiscoveryOptions,
): DeviceDiscoveryOverride | undefined => {
  const defaults = options.overrides?.deviceDefaults;
  const exact = getExactDeviceOverride(device, options);
  if (!defaults) {
    return exact;
  }
  return { ...defaults, ...exact };
};

const getExactPropertyOverride = (
  device: NormalizedHomieDevice,
  property: NormalizedHomieProperty,
  options: ResolvedDiscoveryOptions,
): PropertyDiscoveryOverride | undefined => {
  const deviceOverride = getDeviceOverride(device, options);
  // Homie v3 array nodes are declared as a base node but expanded as node_1, node_2...
  // Overrides on the base path intentionally apply to every expanded element.
  const baseLegacyArrayNodeId = property.nodeId.replace(/_\d+$/, "");
  const propertyPath = `${property.nodeId}/${property.propertyId}`;
  const baseArrayPropertyPath = `${baseLegacyArrayNodeId}/${property.propertyId}`;
  return (
    deviceOverride?.properties?.[propertyPath] ??
    deviceOverride?.properties?.[baseArrayPropertyPath] ??
    deviceOverride?.nodes?.[property.nodeId]?.properties?.[property.propertyId] ??
    deviceOverride?.nodes?.[baseLegacyArrayNodeId]?.properties?.[property.propertyId]
  );
};

const stripRuleMatch = (rule: DiscoveryMappingRule): PropertyDiscoveryOverride => {
  const override: Partial<DiscoveryMappingRule> = { ...rule };
  delete override.match;
  return override;
};

const toGlobRegExp = (pattern: string): RegExp => {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped.replace(/\*/g, ".*").replace(/\?/g, ".")}$`);
};

const matchesString = (
  value: string | undefined,
  matcher: string | string[] | undefined,
): boolean => {
  if (matcher === undefined) {
    return true;
  }
  if (value === undefined) {
    return false;
  }

  const patterns = Array.isArray(matcher) ? matcher : [matcher];
  return patterns.some((pattern) => toGlobRegExp(pattern).test(value));
};

const matchesAnyString = (
  values: Array<string | undefined>,
  matcher: string | string[] | undefined,
): boolean => matcher === undefined || values.some((value) => matchesString(value, matcher));

const matchesScalar = <T>(value: T, matcher: T | T[] | undefined): boolean => {
  if (matcher === undefined) {
    return true;
  }
  return (Array.isArray(matcher) ? matcher : [matcher]).includes(value);
};

const hasConfiguredNodeOverride = (
  device: NormalizedHomieDevice,
  property: NormalizedHomieProperty,
  options: ResolvedDiscoveryOptions,
): boolean => {
  const deviceOverride = getDeviceOverride(device, options);
  const baseLegacyArrayNodeId = property.nodeId.replace(/_\d+$/, "");
  return Boolean(
    deviceOverride?.nodes?.[property.nodeId] ??
    deviceOverride?.nodes?.[baseLegacyArrayNodeId] ??
    deviceOverride?.nodeNames?.[property.nodeId] ??
    deviceOverride?.nodeNames?.[baseLegacyArrayNodeId],
  );
};

const getNamedNodeStateOverride = (
  device: NormalizedHomieDevice,
  property: NormalizedHomieProperty,
  options: ResolvedDiscoveryOptions,
): PropertyDiscoveryOverride | undefined => {
  const namedNodeState = options.overrides?.namedNodeState;
  if (
    !namedNodeState ||
    !getExactDeviceOverride(device, options) ||
    property.propertyId !== "state" ||
    property.datatype !== "boolean" ||
    !property.settable
  ) {
    return undefined;
  }

  const { exclusive, ...propertyOverride } = namedNodeState;
  if (hasConfiguredNodeOverride(device, property, options)) {
    return propertyOverride;
  }

  // `exclusive` turns the friendly `nodeNames` list into an allow-list for
  // common relay boards. Unnamed state booleans are suppressed, while all other
  // Homie properties still follow the normal mapper.
  return exclusive ? { enabled: false } : undefined;
};

const matchesRule = (
  ruleMatch: DiscoveryMappingRuleMatcher,
  device: NormalizedHomieDevice,
  property: NormalizedHomieProperty,
  options: ResolvedDiscoveryOptions,
): boolean => {
  const baseLegacyArrayNodeId = property.nodeId.replace(/_\d+$/, "");
  const nodeIdMatches =
    baseLegacyArrayNodeId === property.nodeId
      ? [property.nodeId]
      : [property.nodeId, baseLegacyArrayNodeId];
  const pathMatches = nodeIdMatches.map((nodeId) => `${nodeId}/${property.propertyId}`);

  return (
    matchesString(device.baseTopic, ruleMatch.baseTopic) &&
    matchesString(device.deviceId, ruleMatch.deviceId) &&
    matchesScalar(device.majorVersion, ruleMatch.majorVersion) &&
    matchesAnyString(nodeIdMatches, ruleMatch.nodeId) &&
    matchesString(property.propertyId, ruleMatch.propertyId) &&
    matchesAnyString(pathMatches, ruleMatch.path) &&
    matchesString(property.nodeName, ruleMatch.nodeName) &&
    matchesString(property.nodeType, ruleMatch.nodeType) &&
    matchesString(property.propertyName, ruleMatch.propertyName) &&
    matchesScalar(property.datatype, ruleMatch.datatype) &&
    matchesScalar(property.settable, ruleMatch.settable) &&
    matchesScalar(property.retained, ruleMatch.retained) &&
    matchesString(property.unit, ruleMatch.unit) &&
    matchesScalar(hasConfiguredNodeOverride(device, property, options), ruleMatch.configuredNode)
  );
};

const getRulePropertyOverride = (
  device: NormalizedHomieDevice,
  property: NormalizedHomieProperty,
  options: ResolvedDiscoveryOptions,
): PropertyDiscoveryOverride | undefined => {
  const matchingRules =
    options.overrides?.rules?.filter((rule) =>
      matchesRule(rule.match, device, property, options),
    ) ?? [];
  if (matchingRules.length === 0) {
    return undefined;
  }

  // Rules are a cascade: broad rules can set defaults and later, narrower rules
  // can refine them. Exact device/node/property overrides still win afterward.
  return Object.assign({}, ...matchingRules.map(stripRuleMatch)) as PropertyDiscoveryOverride;
};

const getPropertyOverride = (
  device: NormalizedHomieDevice,
  property: NormalizedHomieProperty,
  options: ResolvedDiscoveryOptions,
): PropertyDiscoveryOverride | undefined => {
  const shortcutOverride = getNamedNodeStateOverride(device, property, options);
  const ruleOverride = getRulePropertyOverride(device, property, options);
  const exactOverride = getExactPropertyOverride(device, property, options);
  if (!shortcutOverride && !ruleOverride) {
    return exactOverride;
  }
  // Precedence is intentionally simple for users:
  // namedNodeState defaults < ordered rules < exact device/node/property data.
  return { ...shortcutOverride, ...ruleOverride, ...exactOverride };
};

export const getDeviceObjectId = (
  device: Pick<NormalizedHomieDevice, "baseTopic" | "deviceId">,
  options: Pick<ResolvedDiscoveryOptions, "idPrefix" | "overrides">,
): string => {
  const exactOverride =
    options.overrides?.devices?.[device.baseTopic] ?? options.overrides?.devices?.[device.deviceId];
  const objectIdTemplate = exactOverride?.objectId ?? options.overrides?.deviceDefaults?.objectId;
  if (objectIdTemplate) {
    return toObjectIdSegment(renderTemplate(objectIdTemplate, createDeviceTemplateContext(device)));
  }

  const namespace = device.baseTopic.split("/").slice(0, -1).join("_");
  return [options.idPrefix, namespace, device.deviceId].map(toObjectIdSegment).join("_");
};

const buildHomeAssistantDevice = (
  device: NormalizedHomieDevice,
  objectId: string,
  options: ResolvedDiscoveryOptions,
): HomeAssistantDevice => {
  const deviceOverride = getDeviceOverride(device, options);
  const templateContext = createDeviceTemplateContext(device);
  const baseDevice: HomeAssistantDevice = {
    identifiers: deviceOverride?.identifiers
      ? renderTemplateArray(deviceOverride.identifiers, templateContext)
      : [`${options.idPrefix}:${device.baseTopic}`],
    name:
      renderOptionalTemplate(deviceOverride?.name, templateContext) ??
      device.name ??
      device.deviceId,
    manufacturer:
      renderOptionalTemplate(deviceOverride?.manufacturer, templateContext) ?? options.manufacturer,
    model:
      renderOptionalTemplate(deviceOverride?.model, templateContext) ??
      device.type ??
      options.model,
  };

  if (!deviceOverride?.model && !device.type && device.firmwareName) {
    baseDevice.model = device.firmwareName;
  }

  if (device.swVersion) {
    baseDevice.sw_version = device.swVersion;
  }

  if (device.mac) {
    baseDevice.connections = [["mac", device.mac]];
  }

  if (deviceOverride?.viaDevice) {
    baseDevice.via_device = renderTemplate(deviceOverride.viaDevice, templateContext);
  } else if (device.parent || device.root) {
    // Homie v5 models a tree: `root` identifies the root device, while `parent`
    // identifies the direct parent when the direct parent is not the root.
    // Home Assistant's via_device should point at the direct upstream device.
    baseDevice.via_device = `${options.idPrefix}:${device.parent ?? device.root}`;
  }

  if (!baseDevice.name) {
    baseDevice.name = objectId;
  }

  return baseDevice;
};

const splitEnumFormat = (format: string | undefined): string[] => {
  if (!format) {
    return [];
  }

  const values: string[] = [];
  let current = "";
  for (let index = 0; index < format.length; index += 1) {
    const char = format[index];
    const next = format[index + 1];
    if (char === "," && next === ",") {
      current += ",";
      index += 1;
      continue;
    }

    if (char === ",") {
      if (current.length > 0) {
        values.push(current);
      }
      current = "";
      continue;
    }

    current += char;
  }

  if (current.length > 0) {
    values.push(current);
  }

  return values;
};

const resolveBooleanPayloads = (
  property: NormalizedHomieProperty,
  override: PropertyDiscoveryOverride | undefined,
): { payload_on: string; payload_off: string } => {
  const booleanFormat = splitEnumFormat(property.format);
  return {
    payload_on: override?.payloadOn ?? booleanFormat[1] ?? "true",
    payload_off: override?.payloadOff ?? booleanFormat[0] ?? "false",
  };
};

const parseFiniteNumber = (value: string): number | undefined => {
  if (value.length === 0) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const parseNumberFormat = (
  format: string | undefined,
): Pick<NumberComponent, "min" | "max" | "step"> => {
  if (!format) {
    return {};
  }

  const [rawMin = "", rawMax = "", rawStep = ""] = format.split(":");
  const min = parseFiniteNumber(rawMin);
  const max = parseFiniteNumber(rawMax);
  const step = parseFiniteNumber(rawStep);

  return {
    ...(min !== undefined ? { min } : {}),
    ...(max !== undefined ? { max } : {}),
    ...(step !== undefined && step > 0 ? { step } : {}),
  };
};

const SEMANTIC_TOKEN_ALIASES: Readonly<Record<string, CommandableBooleanPlatform>> = {
  bulb: "light",
  bulbs: "light",
  fan: "fan",
  fans: "fan",
  lamp: "light",
  lamps: "light",
  led: "light",
  leds: "light",
  light: "light",
  lighting: "light",
  lights: "light",
};

const GENERIC_BOOLEAN_PROPERTY_TOKENS = new Set(["enabled", "on", "power", "state", "status"]);

const semanticTokens = (...values: Array<string | undefined>): string[] =>
  values
    .flatMap((value) => value?.toLowerCase().match(/[a-z0-9]+/g) ?? [])
    .filter((token) => token.length > 0);

const firstSemanticPlatform = (tokens: string[]): CommandableBooleanPlatform | undefined => {
  for (const token of tokens) {
    const platform = SEMANTIC_TOKEN_ALIASES[token];
    if (platform) {
      return platform;
    }
  }
  return undefined;
};

const inferCommandableBooleanPlatform = (
  property: NormalizedHomieProperty,
  options: ResolvedDiscoveryOptions,
): CommandableBooleanPlatform => {
  const configured = options.defaultCommandableBooleanPlatform;
  if (configured && configured !== "auto") {
    return configured;
  }

  const propertyTokens = semanticTokens(property.propertyId, property.propertyName);
  const propertyPlatform = firstSemanticPlatform(
    propertyTokens.filter((token) => !GENERIC_BOOLEAN_PROPERTY_TOKENS.has(token)),
  );
  if (propertyPlatform) {
    return propertyPlatform;
  }

  const nodePlatform = firstSemanticPlatform(
    semanticTokens(property.nodeType, property.nodeId, property.nodeName),
  );
  return nodePlatform ?? "switch";
};

const inferPlatform = (
  property: NormalizedHomieProperty,
  options: ResolvedDiscoveryOptions,
  override: PropertyDiscoveryOverride | undefined,
): { platform: HomeAssistantPlatform; commandable: boolean } => {
  if (override?.platform) {
    const canCommand =
      property.settable &&
      ["switch", "light", "fan", "number", "select", "text"].includes(override.platform);
    return { platform: override.platform, commandable: canCommand };
  }

  if (property.datatype === "boolean") {
    return property.settable
      ? { platform: inferCommandableBooleanPlatform(property, options), commandable: true }
      : { platform: "binary_sensor", commandable: false };
  }

  if (property.settable) {
    if (property.datatype === "enum") {
      const hasOptions =
        splitEnumFormat(property.format).length > 0 ||
        (override?.options !== undefined && override.options.length > 0);
      return hasOptions
        ? { platform: "select", commandable: true }
        : { platform: "text", commandable: true };
    }

    if (property.datatype === "integer" || property.datatype === "float") {
      return { platform: "number", commandable: true };
    }

    return { platform: "text", commandable: true };
  }

  return { platform: "sensor", commandable: false };
};

const toDisplayLabel = (value: string): string =>
  value
    .split(/[-_]+/)
    .filter((part) => part.length > 0)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");

const buildEntityName = (
  device: NormalizedHomieDevice,
  property: NormalizedHomieProperty,
  options: ResolvedDiscoveryOptions,
  override: PropertyDiscoveryOverride | undefined,
  context: TemplateContext,
): string => {
  if (override?.name) {
    return renderTemplate(override.name, context);
  }

  const deviceOverride = getDeviceOverride(device, options);
  const getConfiguredNodeName = (nodeId: string): string | undefined => {
    const nodeName = deviceOverride?.nodes?.[nodeId]?.name ?? deviceOverride?.nodeNames?.[nodeId];
    return typeof nodeName === "string" ? nodeName : nodeName?.name;
  };
  const nodeNameOverride = getConfiguredNodeName(property.nodeId);
  const baseLegacyArrayNodeId = property.nodeId.replace(/_\d+$/, "");
  const baseLegacyArrayNodeNameOverride = getConfiguredNodeName(baseLegacyArrayNodeId);
  if (property.propertyId === "state" && (nodeNameOverride ?? baseLegacyArrayNodeNameOverride)) {
    return renderTemplate(
      nodeNameOverride ?? baseLegacyArrayNodeNameOverride ?? property.nodeId,
      context,
    );
  }

  if (property.propertyId === "state" && property.nodeName) {
    return property.nodeName;
  }

  if (property.nodeName && property.propertyName && property.nodeName !== property.propertyName) {
    return `${property.nodeName} ${property.propertyName}`;
  }

  if (property.nodeName && property.propertyId !== "state") {
    return `${property.nodeName} ${toDisplayLabel(property.propertyId)}`;
  }

  return (
    property.propertyName ??
    property.nodeName ??
    `${toDisplayLabel(property.nodeId)} ${toDisplayLabel(property.propertyId)}`
  );
};

const UNIT_DEVICE_CLASSES: Record<string, string> = {
  "°c": "temperature",
  "°f": "temperature",
  k: "temperature",
  pa: "pressure",
  hpa: "pressure",
  kpa: "pressure",
  mbar: "pressure",
  bar: "pressure",
  psi: "pressure",
  w: "power",
  kw: "power",
  wh: "energy",
  kwh: "energy",
  mwh: "energy",
  v: "voltage",
  mv: "voltage",
  a: "current",
  ma: "current",
  hz: "frequency",
  khz: "frequency",
  mhz: "frequency",
  ghz: "frequency",
  lx: "illuminance",
  lux: "illuminance",
  dbm: "signal_strength",
};

const normalizeUnit = (unit: string): string => unit.replace(/\s+/g, "").toLowerCase();

const getPropertySemanticText = (property: NormalizedHomieProperty): string =>
  [
    property.nodeId,
    property.propertyId,
    property.nodeName,
    property.nodeType,
    property.propertyName,
  ]
    .filter((value): value is string => value !== undefined)
    .join(" ")
    .toLowerCase();

const inferSensorDeviceClass = (
  property: NormalizedHomieProperty,
  unit: string | undefined,
): string | undefined => {
  if (!unit) {
    return undefined;
  }

  const normalizedUnit = normalizeUnit(unit);
  const unitDeviceClass = UNIT_DEVICE_CLASSES[normalizedUnit];
  if (unitDeviceClass) {
    return unitDeviceClass;
  }

  if (normalizedUnit !== "%") {
    return undefined;
  }

  // Percent is ambiguous in HA: it may be humidity, battery, position, load, etc.
  // Only infer classes where Homie names provide clear semantic intent.
  const semanticText = getPropertySemanticText(property);
  if (semanticText.includes("humidity")) {
    return "humidity";
  }
  if (semanticText.includes("battery")) {
    return "battery";
  }

  return undefined;
};

const applySensorMetadata = (
  config: DiscoveryComponent,
  property: NormalizedHomieProperty,
  override: PropertyDiscoveryOverride | undefined,
): void => {
  if (override?.icon) {
    config.icon = override.icon;
  } else if (property.icon) {
    config.icon = property.icon;
  }
  if (override?.entityCategory) {
    config.entity_category = override.entityCategory;
  } else if (property.entityCategory) {
    config.entity_category = property.entityCategory;
  }
  if (override?.deviceClass) {
    config.device_class = override.deviceClass;
  } else if (property.deviceClass) {
    config.device_class = property.deviceClass;
  }
  if (override?.stateClass) {
    config.state_class = override.stateClass;
  } else if (property.stateClass) {
    config.state_class = property.stateClass;
  }
  if (override?.valueTemplate) {
    config.value_template = override.valueTemplate;
  } else if (property.valueTemplate) {
    config.value_template = property.valueTemplate;
  }
  if (override?.jsonAttributesTopic) {
    config.json_attributes_topic = override.jsonAttributesTopic;
  } else if (property.jsonAttributesTopic && !config.json_attributes_topic) {
    config.json_attributes_topic = property.jsonAttributesTopic;
  }
  if (override?.jsonAttributesTemplate) {
    config.json_attributes_template = override.jsonAttributesTemplate;
  }
  if (override?.enabledByDefault !== undefined) {
    config.enabled_by_default = override.enabledByDefault;
  }
  if (override?.entityPicture) {
    config.entity_picture = override.entityPicture;
  }
  if (override?.expireAfter !== undefined) {
    config.expire_after = override.expireAfter;
  }
  if (override?.suggestedDisplayPrecision !== undefined) {
    config.suggested_display_precision = override.suggestedDisplayPrecision;
  }

  const unit = override?.unit ?? property.unit;
  const inferredDeviceClass = override?.deviceClass ?? inferSensorDeviceClass(property, unit);
  if (inferredDeviceClass && (config.platform === "sensor" || config.platform === "number")) {
    config.device_class = inferredDeviceClass;
  }

  if (unit && (config.platform === "sensor" || config.platform === "number")) {
    config.unit_of_measurement = unit;
  }

  if (
    config.platform === "sensor" &&
    property.inferStateClass !== false &&
    !override?.deviceClass &&
    !override?.stateClass &&
    !property.stateClass
  ) {
    if (property.datatype === "integer" || property.datatype === "float") {
      config.state_class = "measurement";
    } else if (property.datatype === "datetime") {
      config.device_class = "timestamp";
    } else if (property.datatype === "duration") {
      config.device_class = "duration";
    } else if (property.datatype === "json" && !config.value_template) {
      config.value_template = "{{ 'json' }}";
      config.json_attributes_topic = property.stateTopic;
    }
  }

  if (
    property.retained === false &&
    (config.platform === "sensor" || config.platform === "binary_sensor")
  ) {
    config.force_update = true;
  }

  if (override?.forceUpdate !== undefined) {
    config.force_update = override.forceUpdate;
  }

  if (override?.ha) {
    Object.assign(config as unknown as Record<string, unknown>, override.ha);
  }
};

const buildPropertyComponent = (
  device: NormalizedHomieDevice,
  deviceObjectId: string,
  property: NormalizedHomieProperty,
  options: ResolvedDiscoveryOptions,
): ComponentEntry | undefined => {
  const rawOverride = getPropertyOverride(device, property, options);
  if (rawOverride?.enabled === false) {
    return undefined;
  }
  const { platform, commandable } = inferPlatform(property, options, rawOverride);
  const preliminaryContext = createPropertyTemplateContext(device, property, {
    deviceObjectId,
    platform,
  });

  const inferredObjectId = property.objectId
    ? [deviceObjectId, toObjectIdSegment(property.objectId)].join("_")
    : [
        deviceObjectId,
        toObjectIdSegment(property.nodeId),
        toObjectIdSegment(property.propertyId),
      ].join("_");
  const entityObjectId = rawOverride?.objectId
    ? toObjectIdSegment(renderTemplate(rawOverride.objectId, preliminaryContext))
    : inferredObjectId;
  const templateContext = createPropertyTemplateContext(device, property, {
    deviceObjectId,
    platform,
    entityObjectId,
  });
  const override = renderPropertyOverride(rawOverride, templateContext);
  const baseComponent = {
    name: buildEntityName(device, property, options, override, templateContext),
    unique_id: entityObjectId,
    default_entity_id: override?.defaultEntityId ?? `${platform}.${entityObjectId}`,
    state_topic: override?.stateTopic ?? property.stateTopic,
  };

  if (commandable && (platform === "switch" || platform === "light" || platform === "fan")) {
    const payloads = resolveBooleanPayloads(property, override);
    const config: ToggleComponent = {
      ...baseComponent,
      platform,
      command_topic: override?.commandTopic ?? property.commandTopic,
      payload_on: payloads.payload_on,
      payload_off: payloads.payload_off,
    };
    applySensorMetadata(config, property, override);
    return {
      id: entityObjectId,
      platform,
      config,
    };
  }

  if (commandable && platform === "select") {
    const config: SelectComponent = {
      ...baseComponent,
      platform,
      command_topic: override?.commandTopic ?? property.commandTopic,
      options: override?.options ?? splitEnumFormat(property.format),
    };
    applySensorMetadata(config, property, override);
    return {
      id: entityObjectId,
      platform,
      config,
    };
  }

  if (commandable && platform === "number") {
    const config: NumberComponent = {
      ...baseComponent,
      platform,
      command_topic: override?.commandTopic ?? property.commandTopic,
      mode: "box",
      ...parseNumberFormat(property.format),
      ...(override?.min !== undefined ? { min: override.min } : {}),
      ...(override?.max !== undefined ? { max: override.max } : {}),
      ...(override?.step !== undefined ? { step: override.step } : {}),
    };
    applySensorMetadata(config, property, override);
    return { id: entityObjectId, platform, config };
  }

  if (commandable && platform === "text") {
    const config: TextComponent = {
      ...baseComponent,
      platform,
      command_topic: override?.commandTopic ?? property.commandTopic,
      mode: "text",
    };
    applySensorMetadata(config, property, override);
    return {
      id: entityObjectId,
      platform,
      config,
    };
  }

  const payloads = resolveBooleanPayloads(property, override);
  const config: DiscoveryComponent =
    platform === "binary_sensor"
      ? {
          ...baseComponent,
          platform,
          payload_on: payloads.payload_on,
          payload_off: payloads.payload_off,
        }
      : {
          ...baseComponent,
          platform: "sensor",
        };
  applySensorMetadata(config, property, override);
  return { id: entityObjectId, platform: config.platform, config };
};

const toComponentPlatformMap = (entries: ComponentEntry[]): Record<string, HomeAssistantPlatform> =>
  Object.fromEntries(entries.map((entry) => [entry.id, entry.platform]));

const findRemovedComponents = (
  previous: Record<string, HomeAssistantPlatform> | undefined,
  current: Record<string, HomeAssistantPlatform>,
): Record<string, HomeAssistantPlatform> => {
  if (!previous) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(previous).filter(
      ([componentId, previousPlatform]) =>
        !(componentId in current) || current[componentId] !== previousPlatform,
    ),
  );
};

const buildDeviceDiscoveryMessage = (
  device: NormalizedHomieDevice,
  deviceObjectId: string,
  haDevice: HomeAssistantDevice,
  options: ResolvedDiscoveryOptions,
  entries: ComponentEntry[],
  removedComponents: Record<string, HomeAssistantPlatform> = {},
): DiscoveryMessage => {
  const payload: DeviceDiscoveryPayload = {
    device: haDevice,
    origin: options.origin,
    availability_topic: `${device.baseTopic}/$state`,
    availability_template: "{{ 'online' if value == 'ready' else 'offline' }}",
    payload_available: "online",
    payload_not_available: "offline",
    qos: 1,
    components: Object.fromEntries(entries.map((entry) => [entry.id, entry.config])),
  };

  for (const [componentId, platform] of Object.entries(removedComponents)) {
    payload.components[componentId] = { platform };
  }

  return {
    topic: `${options.discoveryPrefix}/device/${deviceObjectId}/config`,
    payload: payload as unknown as Record<string, unknown>,
    qos: 1,
    retain: true,
  };
};

const buildStateSensorMessage = (
  device: NormalizedHomieDevice,
  deviceObjectId: string,
  haDevice: HomeAssistantDevice,
  options: ResolvedDiscoveryOptions,
): DiscoveryMessage => {
  const componentId = `${deviceObjectId}_homie_state`;
  const payload: StateSensorPayload = {
    name: "Homie State",
    unique_id: componentId,
    default_entity_id: `sensor.${componentId}`,
    state_topic: `${device.baseTopic}/$state`,
    icon: "mdi:state-machine",
    entity_category: "diagnostic",
    device: haDevice,
    origin: options.origin,
  };

  return {
    topic: `${options.discoveryPrefix}/sensor/${componentId}/config`,
    payload: payload as unknown as Record<string, unknown>,
    qos: 1,
    retain: true,
  };
};

const buildSignature = (messages: DiscoveryMessage[]): string =>
  JSON.stringify(messages.map((message) => ({ topic: message.topic, payload: message.payload })));

export const buildDiscoveryMessages = (
  device: NormalizedHomieDevice,
  options: ResolvedDiscoveryOptions,
  lastComponentPlatforms?: Record<string, HomeAssistantPlatform>,
): DiscoveryBuildResult => {
  const deviceObjectId = getDeviceObjectId(device, options);
  const haDevice = buildHomeAssistantDevice(device, deviceObjectId, options);
  const entries = device.properties
    .map((property) => buildPropertyComponent(device, deviceObjectId, property, options))
    .filter((entry): entry is ComponentEntry => entry !== undefined);
  const componentPlatforms = toComponentPlatformMap(entries);
  const removedComponents = findRemovedComponents(lastComponentPlatforms, componentPlatforms);

  const messages: DiscoveryMessage[] = [];
  if (Object.keys(removedComponents).length > 0) {
    // HA device discovery removes components when the component id is present with only
    // its platform. Send this transitional payload before the final current payload.
    messages.push(
      buildDeviceDiscoveryMessage(
        device,
        deviceObjectId,
        haDevice,
        options,
        entries,
        removedComponents,
      ),
    );
  }

  messages.push(buildDeviceDiscoveryMessage(device, deviceObjectId, haDevice, options, entries));
  if (options.includeStateSensor) {
    messages.push(buildStateSensorMessage(device, deviceObjectId, haDevice, options));
  }

  return {
    messages,
    componentPlatforms,
    signature: buildSignature(messages),
  };
};

export const buildCleanupMessages = (
  device: Pick<NormalizedHomieDevice, "baseTopic" | "deviceId">,
  options: ResolvedDiscoveryOptions,
): DiscoveryMessage[] => {
  const deviceObjectId = getDeviceObjectId(device, options);
  const messages: DiscoveryMessage[] = [
    {
      topic: `${options.discoveryPrefix}/device/${deviceObjectId}/config`,
      payload: "",
      qos: 1,
      retain: true,
    },
  ];

  if (options.includeStateSensor) {
    messages.push({
      topic: `${options.discoveryPrefix}/sensor/${deviceObjectId}_homie_state/config`,
      payload: "",
      qos: 1,
      retain: true,
    });
  }

  return messages;
};
