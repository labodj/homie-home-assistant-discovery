import {
  buildCleanupMessages,
  buildDiscoveryMessages,
  validateDiscoveryMessage,
  resolveDiscoveryOptions,
} from "./ha-discovery";
import { LegacyHomieCollector } from "./legacy-collector";
import { parseHomieV5Description } from "./homie-v5";
import { parseHomieTopic } from "./topic";
import type {
  DiscoveryMessage,
  HomieDatatype,
  HomeAssistantPlatform,
  HomieHaDiscoveryOptions,
  HomieMajorVersion,
  IngestResult,
  MqttMessageInput,
  NormalizedHomieDevice,
  NormalizedHomieProperty,
} from "./types";
import { HOMIE_ID_PATTERN, payloadToString, toObjectIdSegment } from "./utils";

interface DevicePublicationState {
  device: Pick<NormalizedHomieDevice, "baseTopic" | "deviceId">;
  lastComponentPlatforms?: Record<string, HomeAssistantPlatform>;
  lastSignature?: string;
  lastMessages?: DiscoveryMessage[];
}

interface PendingPublication {
  nextState?: DevicePublicationState;
}

interface V5DeviceState {
  description?: NormalizedHomieDevice;
  attributes: Map<string, NormalizedHomieProperty>;
  deviceMetadata: Partial<Pick<NormalizedHomieDevice, "firmwareName" | "mac" | "swVersion">>;
}

const ACRONYMS: Record<string, string> = {
  fw: "Firmware",
  ip: "IP",
  mac: "MAC",
  mqtt: "MQTT",
  ota: "OTA",
  wifi: "WiFi",
};

const DIAGNOSTIC_TOKENS = [
  "implementation",
  "description",
  "disconnect",
  "inbound",
  "outbound",
  "enabled",
  "dropped",
  "version",
  "signal",
  "status",
  "reason",
  "config",
  "uptime",
  "local",
  "stats",
  "depth",
  "heap",
  "free",
  "name",
  "wifi",
  "mqtt",
  "mac",
  "ota",
  "ack",
  "max",
  "fw",
  "ip",
] as const;

const splitDiagnosticSegment = (segment: string): string[] => {
  const normalized = toObjectIdSegment(segment.replace(/^\$/, "")).replace(/_/g, "-");
  const explicitParts = normalized.split("-").filter((part) => part.length > 0);
  return explicitParts.flatMap((part) => {
    const tokens: string[] = [];
    let remaining = part;
    while (remaining.length > 0) {
      const match = DIAGNOSTIC_TOKENS.find((token) => remaining.startsWith(token));
      if (!match) {
        tokens.push(remaining);
        break;
      }
      tokens.push(match);
      remaining = remaining.slice(match.length);
    }
    return tokens;
  });
};

const toDiagnosticTokens = (suffix: string[]): string[] =>
  suffix.flatMap(splitDiagnosticSegment).filter((segment) => segment.length > 0);

const toDiagnosticPropertyId = (suffix: string[]): string => toDiagnosticTokens(suffix).join("-");

const toDiagnosticObjectId = (suffix: string[]): string => toDiagnosticTokens(suffix).join("_");

const toDiagnosticName = (suffix: string[]): string =>
  toDiagnosticTokens(suffix)
    .map(
      (segment) => ACRONYMS[segment.toLowerCase()] ?? segment[0].toUpperCase() + segment.slice(1),
    )
    .join(" ");

const inferAttributeDatatype = (payload: string): HomieDatatype => {
  const trimmed = payload.trim();
  if (trimmed === "true" || trimmed === "false") {
    return "boolean";
  }
  if (/^-?\d+$/.test(trimmed)) {
    return "integer";
  }
  if (trimmed.length > 0 && Number.isFinite(Number(trimmed))) {
    return "float";
  }

  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed === "object" && parsed !== null) {
      return "json";
    }
  } catch {
    // Non-JSON payloads are valid string attributes.
  }

  return "string";
};

// These v5 core topics drive lifecycle, discovery, logging or alert behavior.
// Publishing them as generic diagnostics would create noisy or misleading HA entities.
const V5_OPERATIONAL_DEVICE_ATTRIBUTES = new Set(["$alert", "$description", "$log", "$state"]);
const V5_COLLECTION_DEVICE_ATTRIBUTES = new Set(["$stats"]);

const isV5ImplementationCommandTopic = (suffix: string[]): boolean =>
  suffix[0] === "$implementation" &&
  ((suffix.length === 2 && suffix[1] === "reset") ||
    (suffix[1] === "ota" && suffix[2] === "firmware"));

const isV5AttributeDiagnosticTopic = (suffix: string[]): boolean =>
  suffix.length > 0 &&
  suffix[0].startsWith("$") &&
  !V5_OPERATIONAL_DEVICE_ATTRIBUTES.has(suffix[0]) &&
  !(suffix.length === 1 && V5_COLLECTION_DEVICE_ATTRIBUTES.has(suffix[0])) &&
  !isV5ImplementationCommandTopic(suffix) &&
  suffix.at(-1) !== "set";

const V5_DEVICE_METADATA_KEYS: Record<
  string,
  keyof Pick<NormalizedHomieDevice, "firmwareName" | "mac" | "swVersion">
> = {
  "$fw/name": "firmwareName",
  "$fw/version": "swVersion",
  $mac: "mac",
};

const KNOWN_DIAGNOSTIC_METADATA: Record<
  string,
  Partial<
    Pick<
      NormalizedHomieProperty,
      "deviceClass" | "icon" | "objectId" | "propertyName" | "stateClass" | "unit" | "valueTemplate"
    >
  >
> = {
  $mac: { propertyName: "MAC Address", objectId: "mac_address", icon: "mdi:ethernet" },
  $localip: { propertyName: "Local IP", objectId: "local_ip", icon: "mdi:ip-network" },
  $homie: { propertyName: "Homie Version", objectId: "homie_version", icon: "mdi:tag" },
  "$fw/version": {
    propertyName: "Firmware Version",
    objectId: "firmware_version",
    icon: "mdi:cellphone-arrow-down",
  },
  "$fw/name": { propertyName: "Firmware Name", objectId: "firmware_name", icon: "mdi:label" },
  "$fw/checksum": {
    propertyName: "Firmware Checksum",
    objectId: "firmware_checksum",
    icon: "mdi:shield-check-outline",
  },
  "$stats/uptime": {
    propertyName: "Uptime",
    objectId: "uptime",
    icon: "mdi:timer-sand",
    deviceClass: "duration",
    unit: "s",
    stateClass: "measurement",
  },
  "$stats/uptimewifi": {
    propertyName: "WiFi Uptime",
    objectId: "wifi_uptime",
    icon: "mdi:wifi-clock",
    deviceClass: "duration",
    unit: "s",
    stateClass: "measurement",
  },
  "$stats/uptimemqtt": {
    propertyName: "MQTT Uptime",
    objectId: "mqtt_uptime",
    icon: "mdi:network-outline-clock",
    deviceClass: "duration",
    unit: "s",
    stateClass: "measurement",
  },
  "$stats/signal": {
    propertyName: "Signal Strength",
    objectId: "signal_strength",
    icon: "mdi:wifi",
    unit: "%",
    stateClass: "measurement",
  },
  "$stats/freeheap": {
    propertyName: "Free Heap",
    objectId: "free_heap",
    icon: "mdi:memory",
    deviceClass: "data_size",
    unit: "B",
    stateClass: "measurement",
  },
  "$stats/interval": {
    propertyName: "Stats Interval",
    objectId: "stats_interval",
    icon: "mdi:timer-sync-outline",
    unit: "s",
  },
  "$stats/mqttinbounddropped": {
    propertyName: "MQTT Inbound Dropped Since Boot",
    objectId: "mqtt_inbound_dropped",
    icon: "mdi:message-alert-outline",
    stateClass: "total_increasing",
  },
  "$stats/mqttackdropped": {
    propertyName: "MQTT Ack Dropped Since Boot",
    objectId: "mqtt_ack_dropped",
    icon: "mdi:publish-off",
    stateClass: "total_increasing",
  },
  "$stats/mqttinboundmaxdepth": {
    propertyName: "MQTT Inbound Max Queue Depth",
    objectId: "mqtt_inbound_max_depth",
    icon: "mdi:counter",
    stateClass: "measurement",
  },
  "$stats/mqttackmaxdepth": {
    propertyName: "MQTT Ack Max Queue Depth",
    objectId: "mqtt_ack_max_depth",
    icon: "mdi:counter",
    stateClass: "measurement",
  },
  $implementation: { propertyName: "Implementation", icon: "mdi:code-braces" },
  "$implementation/version": { propertyName: "Implementation Version", icon: "mdi:tag-outline" },
  "$implementation/reset/reason": {
    propertyName: "Reset Reason",
    objectId: "reset_reason",
    icon: "mdi:restart-alert",
  },
  "$implementation/wifi/last_disconnect_reason": {
    propertyName: "WiFi Last Disconnect Reason",
    objectId: "wifi_last_disconnect_reason",
    icon: "mdi:wifi-alert",
  },
  "$implementation/mqtt/last_disconnect_reason": {
    propertyName: "MQTT Last Disconnect Reason",
    objectId: "mqtt_last_disconnect_reason",
    icon: "mdi:lan-disconnect",
  },
  "$implementation/config": {
    propertyName: "Implementation Config",
    icon: "mdi:code-json",
    valueTemplate: "{{ 'configured' }}",
  },
  "$implementation/ota/status": {
    propertyName: "OTA Status",
    objectId: "ota_status",
    icon: "mdi:update",
  },
  "$implementation/ota/enabled": {
    propertyName: "OTA Enabled",
    objectId: "ota_enabled",
    icon: "mdi:cellphone-arrow-down-cog",
  },
};

const getKnownDiagnosticMetadata = (
  suffix: string[],
  stateTopic: string,
): Partial<NormalizedHomieProperty> => {
  const key = suffix.join("/");
  const metadata: Partial<NormalizedHomieProperty> = {
    ...(KNOWN_DIAGNOSTIC_METADATA[key] ?? {}),
  };
  if (key === "$implementation/config") {
    metadata.jsonAttributesTopic = stateTopic;
  }
  return metadata;
};

const buildV5DescriptionDiagnostics = (
  device: NormalizedHomieDevice,
): NormalizedHomieProperty[] => {
  const stateTopic = `${device.baseTopic}/$description`;
  const base = {
    deviceId: device.deviceId,
    nodeId: "diagnostics",
    majorVersion: 5 as const,
    baseTopic: device.baseTopic,
    stateTopic,
    commandTopic: `${stateTopic}/set`,
    settable: false,
    retained: true,
    entityCategory: "diagnostic" as const,
  };
  const diagnostics: NormalizedHomieProperty[] = [];

  diagnostics.push({
    ...base,
    propertyId: "description-homie",
    objectId: "homie_version",
    propertyName: "Homie Version",
    datatype: "string",
    icon: "mdi:tag",
    valueTemplate: "{{ value_json.homie }}",
  });

  if (device.version !== undefined) {
    diagnostics.push({
      ...base,
      propertyId: "description-version",
      objectId: "homie_description_version",
      propertyName: "Homie Description Version",
      datatype: "integer",
      icon: "mdi:file-document-refresh-outline",
      valueTemplate: "{{ value_json.version }}",
    });
  }

  diagnostics.push({
    ...base,
    propertyId: "description-extensions",
    objectId: "homie_extensions",
    propertyName: "Homie Extensions",
    datatype: "string",
    icon: "mdi:extension",
    valueTemplate: "{{ value_json.extensions | default([]) | join(',') }}",
  });

  return diagnostics;
};

export class HomieHaDiscoveryBridge {
  private readonly options: ReturnType<typeof resolveDiscoveryOptions>;
  private readonly homieDomain: string;
  private readonly legacyRoot: string;
  private readonly enabledVersions: ReadonlySet<HomieMajorVersion>;
  private readonly legacyCollector = new LegacyHomieCollector();
  private readonly publicationState = new Map<string, DevicePublicationState>();
  private readonly pendingPublications = new Map<string, PendingPublication>();
  private readonly v5Devices = new Map<string, V5DeviceState>();

  public constructor(options: HomieHaDiscoveryOptions = {}) {
    this.options = resolveDiscoveryOptions(options);
    this.homieDomain = options.homieDomain ?? "homie";
    this.legacyRoot = options.legacyRoot ?? "homie";
    this.enabledVersions = new Set(options.enabledVersions ?? [3, 4, 5]);
  }

  public commit(baseTopic?: string): number {
    const targets =
      baseTopic === undefined ? Array.from(this.pendingPublications.keys()) : [baseTopic];
    let committed = 0;

    for (const topic of targets) {
      const pending = this.pendingPublications.get(topic);
      if (!pending) {
        continue;
      }

      if (pending.nextState) {
        this.publicationState.set(topic, pending.nextState);
      } else {
        this.publicationState.delete(topic);
      }

      this.pendingPublications.delete(topic);
      committed += 1;
    }

    return committed;
  }

  public discard(baseTopic?: string): number {
    const targets =
      baseTopic === undefined ? Array.from(this.pendingPublications.keys()) : [baseTopic];
    let discarded = 0;
    for (const topic of targets) {
      if (this.pendingPublications.delete(topic)) {
        discarded += 1;
      }
    }
    return discarded;
  }

  public reseed(): DiscoveryMessage[] {
    return Array.from(this.publicationState.values()).flatMap((state) => state.lastMessages ?? []);
  }

  /**
   * Process one MQTT metadata message and return Home Assistant discovery
   * messages that the caller should publish. The bridge is intentionally
   * stateful so it can emit component-removal transitions for retained MQTT
   * metadata changes instead of leaving stale Home Assistant entities behind.
   */
  public ingest(input: MqttMessageInput): IngestResult {
    const warnings: string[] = [];
    const logs: string[] = [];
    const messages: DiscoveryMessage[] = [];
    const topic = input.topic.trim();
    const parsedTopic = parseHomieTopic(topic, {
      homieDomain: this.homieDomain,
      legacyRoot: this.legacyRoot,
    });

    if (!parsedTopic) {
      return { messages, warnings: [`Ignored non-Homie topic '${input.topic}'.`], logs };
    }

    if (!HOMIE_ID_PATTERN.test(parsedTopic.deviceId)) {
      return {
        messages,
        warnings: [`Ignored Homie device '${parsedTopic.deviceId}' because id is invalid.`],
        logs,
      };
    }

    const payload = payloadToString(input.payload);

    if (parsedTopic.kind === "unsupported-version") {
      return {
        messages,
        warnings: [
          `Ignored Homie topic '${topic}' because Homie major version ${parsedTopic.majorVersion} is not supported.`,
        ],
        logs,
      };
    }

    if (parsedTopic.suffix.length === 1 && parsedTopic.suffix[0] === "$state" && payload === "") {
      messages.push(...this.cleanupDevice(parsedTopic.baseTopic, parsedTopic.deviceId, logs));
      return { messages, warnings, logs };
    }

    if (
      parsedTopic.kind === "v5" &&
      parsedTopic.suffix.length === 1 &&
      parsedTopic.suffix[0] === "$description"
    ) {
      if (payload === "") {
        messages.push(...this.cleanupDevice(parsedTopic.baseTopic, parsedTopic.deviceId, logs));
        return { messages, warnings, logs };
      }

      if (!this.enabledVersions.has(5)) {
        return { messages, warnings, logs };
      }

      const parsedDescription = parseHomieV5Description(
        parsedTopic.deviceId,
        parsedTopic.baseTopic,
        payload,
      );
      warnings.push(...parsedDescription.warnings);
      if (!parsedDescription.ok) {
        // A valid v5 document with zero usable properties is authoritative: if HA discovery
        // was already published, retained configs must be removed instead of left stale.
        if (parsedDescription.shouldCleanup && this.publicationState.has(parsedTopic.baseTopic)) {
          messages.push(...this.cleanupDevice(parsedTopic.baseTopic, parsedTopic.deviceId, logs));
        }
        return { messages, warnings, logs };
      }

      const v5State = this.getOrCreateV5State(parsedTopic.baseTopic);
      v5State.description = parsedDescription.device;
      if (this.options.includeAttributeDiagnostics) {
        this.updateV5Attribute(
          parsedTopic.baseTopic,
          parsedDescription.device.deviceId,
          parsedTopic.suffix,
          payload,
        );
      }
      messages.push(...this.publishV5Device(parsedTopic.baseTopic, logs));
      return { messages, warnings, logs };
    }

    if (parsedTopic.kind === "v5" && isV5ImplementationCommandTopic(parsedTopic.suffix)) {
      return { messages, warnings, logs };
    }

    if (
      parsedTopic.kind === "v5" &&
      this.enabledVersions.has(5) &&
      this.options.includeAttributeDiagnostics &&
      isV5AttributeDiagnosticTopic(parsedTopic.suffix)
    ) {
      const changed = this.updateV5Attribute(
        parsedTopic.baseTopic,
        parsedTopic.deviceId,
        parsedTopic.suffix,
        payload,
      );
      if (changed) {
        messages.push(...this.publishV5Device(parsedTopic.baseTopic, logs));
      }
      return { messages, warnings, logs };
    }

    if (parsedTopic.kind === "legacy") {
      const legacyUpdate = this.legacyCollector.update(
        parsedTopic.baseTopic,
        parsedTopic.deviceId,
        parsedTopic.suffix,
        payload,
      );
      warnings.push(...legacyUpdate.warnings);
      if (legacyUpdate.device) {
        if (this.enabledVersions.has(legacyUpdate.device.majorVersion)) {
          messages.push(...this.publishDevice(legacyUpdate.device, logs));
        } else if (this.publicationState.has(parsedTopic.baseTopic)) {
          messages.push(...this.cleanupDevice(parsedTopic.baseTopic, parsedTopic.deviceId, logs));
        }
      } else if (this.publicationState.has(parsedTopic.baseTopic)) {
        // Legacy metadata arrives topic-by-topic. Once a published model becomes incomplete
        // or unsupported, the safest retained MQTT behavior is to delete the HA discovery.
        messages.push(...this.cleanupDevice(parsedTopic.baseTopic, parsedTopic.deviceId, logs));
      }
    }

    return { messages, warnings, logs };
  }

  /** Forget a single device and return retained cleanup messages when needed. */
  public removeDevice(baseTopic: string, deviceId: string): DiscoveryMessage[] {
    this.legacyCollector.removeDevice(baseTopic);
    this.v5Devices.delete(baseTopic);
    const state = this.publicationState.get(baseTopic);
    this.pendingPublications.delete(baseTopic);
    const messages = state?.lastComponentPlatforms
      ? buildCleanupMessages({ baseTopic, deviceId }, this.options)
      : [];

    if (!state?.lastComponentPlatforms) {
      return [];
    }

    if (this.options.autoApply) {
      this.publicationState.delete(baseTopic);
    } else {
      this.pendingPublications.set(baseTopic, { nextState: undefined });
    }

    return messages;
  }

  /** Clear all remembered devices and return retained cleanup messages. */
  public reset(): DiscoveryMessage[] {
    const cleanupMessages = Array.from(this.publicationState.values()).flatMap((state) =>
      state.lastComponentPlatforms ? buildCleanupMessages(state.device, this.options) : [],
    );
    this.legacyCollector.clear();
    this.v5Devices.clear();
    this.publicationState.clear();
    this.pendingPublications.clear();
    return cleanupMessages;
  }

  private getOrCreateV5State(baseTopic: string): V5DeviceState {
    let state = this.v5Devices.get(baseTopic);
    if (!state) {
      state = {
        attributes: new Map<string, NormalizedHomieProperty>(),
        deviceMetadata: {},
      };
      this.v5Devices.set(baseTopic, state);
    }
    return state;
  }

  private updateV5Attribute(
    baseTopic: string,
    deviceId: string,
    suffix: string[],
    payload: string,
  ): boolean {
    if (!isV5AttributeDiagnosticTopic(suffix)) {
      return false;
    }

    const state = this.getOrCreateV5State(baseTopic);
    const key = suffix.join("/");
    const metadataKey = V5_DEVICE_METADATA_KEYS[key];
    if (payload === "") {
      const hadAttribute = state.attributes.delete(key);
      if (metadataKey) {
        delete state.deviceMetadata[metadataKey];
      }
      return hadAttribute;
    }

    if (metadataKey) {
      state.deviceMetadata[metadataKey] = payload.trim();
    }

    const objectId = toDiagnosticObjectId(suffix);
    const datatype = inferAttributeDatatype(payload);
    const stateTopic = `${baseTopic}/${suffix.join("/")}`;
    state.attributes.set(key, {
      deviceId,
      nodeId: "diagnostics",
      propertyId: toDiagnosticPropertyId(suffix),
      objectId,
      majorVersion: 5,
      baseTopic,
      stateTopic,
      commandTopic: `${stateTopic}/set`,
      datatype,
      settable: false,
      retained: true,
      entityCategory: "diagnostic",
      valueTemplate: datatype === "json" ? "{{ 'json' }}" : undefined,
      jsonAttributesTopic: datatype === "json" ? stateTopic : undefined,
      propertyName: toDiagnosticName(suffix),
      ...getKnownDiagnosticMetadata(suffix, stateTopic),
    });

    return true;
  }

  private publishV5Device(baseTopic: string, logs: string[]): DiscoveryMessage[] {
    const state = this.v5Devices.get(baseTopic);
    if (!state?.description) {
      return [];
    }

    const attributes = [
      ...buildV5DescriptionDiagnostics(state.description),
      ...Array.from(state.attributes.values()),
    ].sort((left, right) => {
      const leftKey = `${left.nodeId}/${left.propertyId}`;
      const rightKey = `${right.nodeId}/${right.propertyId}`;
      return leftKey.localeCompare(rightKey);
    });

    return this.publishDevice(
      {
        ...state.description,
        ...state.deviceMetadata,
        properties: [...state.description.properties, ...attributes],
      },
      logs,
    );
  }

  private publishDevice(device: NormalizedHomieDevice, logs: string[]): DiscoveryMessage[] {
    const previous = this.publicationState.get(device.baseTopic);
    const built = buildDiscoveryMessages(device, this.options, previous?.lastComponentPlatforms);

    if (built.signature === previous?.lastSignature) {
      if (!this.options.autoApply) {
        this.pendingPublications.delete(device.baseTopic);
      }
      return [];
    }

    const nextState: DevicePublicationState = {
      device: { baseTopic: device.baseTopic, deviceId: device.deviceId },
      lastComponentPlatforms: built.componentPlatforms,
      lastSignature: built.signature,
      lastMessages: built.stableMessages,
    };
    const validationErrors = built.messages.flatMap((message) =>
      validateDiscoveryMessage(message).map(
        (error) =>
          `Invalid discovery message '${message.topic}' for '${device.baseTopic}': ${error}`,
      ),
    );
    if (validationErrors.length > 0) {
      logs.push(...validationErrors);
      return [];
    }

    this.stagePublication(device.baseTopic, { nextState });

    logs.push(`Generated Home Assistant discovery for '${device.deviceId}'.`);
    return built.messages;
  }

  private stagePublication(baseTopic: string, candidate: PendingPublication): void {
    if (this.options.autoApply) {
      this.pendingPublications.delete(baseTopic);
      if (candidate.nextState) {
        this.publicationState.set(baseTopic, candidate.nextState);
      }
    } else {
      this.pendingPublications.set(baseTopic, candidate);
    }
  }

  private cleanupDevice(baseTopic: string, deviceId: string, logs: string[]): DiscoveryMessage[] {
    const cleanupMessages = this.removeDevice(baseTopic, deviceId);
    if (cleanupMessages.length > 0) {
      logs.push(`Removed Home Assistant discovery for '${deviceId}'.`);
    }
    return cleanupMessages;
  }
}
