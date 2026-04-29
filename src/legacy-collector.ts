import type {
  HomieDatatype,
  HomieMajorVersion,
  NormalizedHomieDevice,
  NormalizedHomieProperty,
} from "./types";
import { HOMIE_ID_PATTERN, normalizeOptionalString, parseBoolean, uniqueSorted } from "./utils";

interface LegacyNodeState {
  name?: string;
  type?: string;
  isArray?: boolean;
  arrayRange?: { start: number; end: number };
  arrayElementNames: Map<number, string>;
  properties: Set<string>;
}

interface LegacyPropertyState {
  name?: string;
  datatype?: HomieDatatype;
  format?: string;
  settable?: boolean;
  retained?: boolean;
  unit?: string;
}

interface LegacyDeviceState {
  deviceId: string;
  baseTopic: string;
  majorVersion?: Exclude<HomieMajorVersion, 5>;
  name?: string;
  firmwareName?: string;
  firmwareVersion?: string;
  localIp?: string;
  mac?: string;
  stats: Set<string>;
  nodes: Set<string>;
  nodeState: Map<string, LegacyNodeState>;
  propertyState: Map<string, LegacyPropertyState>;
}

const LEGACY_DATATYPES = new Set<HomieDatatype>([
  "integer",
  "float",
  "boolean",
  "string",
  "enum",
  "color",
]);

const LEGACY_STATS_PROPERTIES: Record<
  string,
  {
    datatype: HomieDatatype;
    propertyName: string;
    unit?: string;
    deviceClass?: string;
    stateClass?: "measurement" | "total" | "total_increasing";
  }
> = {
  interval: { datatype: "integer", propertyName: "Stats Interval", unit: "s" },
  uptime: { datatype: "integer", propertyName: "Uptime", unit: "s", deviceClass: "duration" },
  signal: { datatype: "integer", propertyName: "Signal", unit: "%" },
  cputemp: {
    datatype: "float",
    propertyName: "CPU Temperature",
    unit: "°C",
    deviceClass: "temperature",
  },
  cpuload: { datatype: "integer", propertyName: "CPU Load", unit: "%" },
  battery: { datatype: "integer", propertyName: "Battery", unit: "%", deviceClass: "battery" },
  freeheap: { datatype: "integer", propertyName: "Free Heap", unit: "B" },
  supply: { datatype: "float", propertyName: "Supply", unit: "V", deviceClass: "voltage" },
};

const splitCsv = (payload: string): string[] =>
  payload
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

const normalizeLegacyDatatype = (value: string): HomieDatatype | undefined => {
  const normalized = value.trim().toLowerCase();
  return LEGACY_DATATYPES.has(normalized as HomieDatatype)
    ? (normalized as HomieDatatype)
    : undefined;
};

const propertyKey = (nodeId: string, propertyId: string): string => `${nodeId}/${propertyId}`;

const ARRAY_NODE_ENTRY_PATTERN = /^([a-z0-9]+(?:-[a-z0-9]+)*)\[\]$/;
const ARRAY_ELEMENT_TOPIC_PATTERN = /^([a-z0-9]+(?:-[a-z0-9]+)*)_(\d+)$/;

const parseArrayRange = (payload: string): { start: number; end: number } | undefined => {
  const [rawStart, rawEnd] = payload.split("-");
  const start = Number(rawStart);
  const end = Number(rawEnd);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) {
    return undefined;
  }

  return { start, end };
};

const getLegacyNodeListEntry = (
  value: string,
): { nodeId: string; isArray: boolean } | undefined => {
  const arrayMatch = ARRAY_NODE_ENTRY_PATTERN.exec(value);
  if (arrayMatch) {
    return { nodeId: arrayMatch[1], isArray: true };
  }

  return HOMIE_ID_PATTERN.test(value) ? { nodeId: value, isArray: false } : undefined;
};

export class LegacyHomieCollector {
  private readonly devices = new Map<string, LegacyDeviceState>();

  public clear(): void {
    this.devices.clear();
  }

  public removeDevice(baseTopic: string): boolean {
    return this.devices.delete(baseTopic);
  }

  public update(
    baseTopic: string,
    deviceId: string,
    suffix: string[],
    payload: string,
  ): { device?: NormalizedHomieDevice; warnings: string[] } {
    const warnings: string[] = [];
    const state = this.getOrCreateDevice(baseTopic, deviceId);

    if (suffix.length === 1) {
      this.updateDeviceAttribute(state, suffix[0], payload, warnings);
    } else if (suffix.length === 2 && suffix[0] === "$fw") {
      this.updateFirmwareAttribute(state, suffix[1], payload);
    } else if (suffix.length === 2 && suffix[0] === "$stats") {
      this.updateStatsAttribute(state, suffix[1], payload, warnings);
    } else if (suffix.length === 2) {
      this.updateNodeAttribute(state, suffix[0], suffix[1], payload, warnings);
    } else if (suffix.length === 3) {
      this.updatePropertyAttribute(state, suffix[0], suffix[1], suffix[2], payload, warnings);
    }

    const device = this.toNormalizedDevice(state);
    return { device, warnings };
  }

  private getOrCreateDevice(baseTopic: string, deviceId: string): LegacyDeviceState {
    let state = this.devices.get(baseTopic);
    if (!state) {
      state = {
        deviceId,
        baseTopic,
        stats: new Set<string>(),
        nodes: new Set<string>(),
        nodeState: new Map<string, LegacyNodeState>(),
        propertyState: new Map<string, LegacyPropertyState>(),
      };
      this.devices.set(baseTopic, state);
    }
    return state;
  }

  private updateDeviceAttribute(
    state: LegacyDeviceState,
    attribute: string,
    payload: string,
    warnings: string[],
  ): void {
    switch (attribute) {
      case "$homie":
        // In retained MQTT metadata an empty payload deletes the attribute. Treat it as
        // unknown state rather than as an unsupported Homie version.
        if (payload === "") {
          state.majorVersion = undefined;
        } else if (payload.startsWith("3.")) {
          state.majorVersion = 3;
        } else if (payload.startsWith("4.")) {
          state.majorVersion = 4;
        } else {
          warnings.push(`Ignored legacy Homie version '${payload}' for '${state.deviceId}'.`);
        }
        break;
      case "$name":
        state.name = normalizeOptionalString(payload);
        break;
      case "$localip":
        state.localIp = normalizeOptionalString(payload);
        break;
      case "$mac":
        state.mac = normalizeOptionalString(payload);
        break;
      case "$nodes":
        state.nodes.clear();
        for (const entry of splitCsv(payload)) {
          const parsedEntry = getLegacyNodeListEntry(entry);
          if (!parsedEntry) {
            warnings.push(`Ignored invalid legacy Homie node list entry '${entry}'.`);
            continue;
          }
          state.nodes.add(parsedEntry.nodeId);
          if (parsedEntry.isArray) {
            this.getOrCreateNode(state, parsedEntry.nodeId).isArray = true;
          }
        }
        break;
    }
  }

  private updateFirmwareAttribute(
    state: LegacyDeviceState,
    attribute: string,
    payload: string,
  ): void {
    switch (attribute) {
      case "name":
        state.firmwareName = normalizeOptionalString(payload);
        break;
      case "version":
        state.firmwareVersion = normalizeOptionalString(payload);
        break;
    }
  }

  private updateStatsAttribute(
    state: LegacyDeviceState,
    attribute: string,
    payload: string,
    warnings: string[],
  ): void {
    if (!(attribute in LEGACY_STATS_PROPERTIES)) {
      warnings.push(`Ignored unsupported legacy Homie stats attribute '${attribute}'.`);
      return;
    }

    if (payload === "") {
      state.stats.delete(attribute);
      return;
    }

    state.stats.add(attribute);
  }

  private updateNodeAttribute(
    state: LegacyDeviceState,
    nodeId: string,
    attribute: string,
    payload: string,
    warnings: string[],
  ): void {
    const arrayElement = ARRAY_ELEMENT_TOPIC_PATTERN.exec(nodeId);
    if (arrayElement && attribute === "$name") {
      const baseNodeId = arrayElement[1];
      const index = Number(arrayElement[2]);
      const node = this.getOrCreateNode(state, baseNodeId);
      const name = normalizeOptionalString(payload);
      if (name) {
        node.arrayElementNames.set(index, name);
      }
      return;
    }

    if (!HOMIE_ID_PATTERN.test(nodeId)) {
      warnings.push(
        `Ignored legacy Homie node '${state.deviceId}/${nodeId}' because id is invalid.`,
      );
      return;
    }

    const node = this.getOrCreateNode(state, nodeId);
    switch (attribute) {
      case "$name":
        node.name = normalizeOptionalString(payload);
        break;
      case "$type":
        node.type = normalizeOptionalString(payload);
        break;
      case "$properties":
        node.properties = new Set();
        for (const propertyId of splitCsv(payload)) {
          if (HOMIE_ID_PATTERN.test(propertyId)) {
            node.properties.add(propertyId);
          } else {
            warnings.push(
              `Ignored invalid legacy Homie property list entry '${propertyId}' for '${state.deviceId}/${nodeId}'.`,
            );
          }
        }
        state.nodes.add(nodeId);
        break;
      case "$array": {
        // Empty retained payload deletes the array range. Without a concrete range the
        // base array declaration cannot be expanded safely into HA entities.
        if (payload === "") {
          node.arrayRange = undefined;
          break;
        }

        const range = parseArrayRange(payload);
        if (range) {
          node.isArray = true;
          node.arrayRange = range;
        } else {
          warnings.push(
            `Ignored invalid legacy Homie array range '${payload}' for '${state.deviceId}/${nodeId}'.`,
          );
        }
        state.nodes.add(nodeId);
        break;
      }
    }
  }

  private updatePropertyAttribute(
    state: LegacyDeviceState,
    nodeId: string,
    propertyId: string,
    attribute: string,
    payload: string,
    warnings: string[],
  ): void {
    if (!HOMIE_ID_PATTERN.test(nodeId) || !HOMIE_ID_PATTERN.test(propertyId)) {
      warnings.push(
        `Ignored legacy Homie property '${state.deviceId}/${nodeId}/${propertyId}' because id is invalid.`,
      );
      return;
    }

    const property = this.getOrCreateProperty(state, nodeId, propertyId);
    this.getOrCreateNode(state, nodeId).properties.add(propertyId);
    state.nodes.add(nodeId);

    switch (attribute) {
      case "$name":
        property.name = normalizeOptionalString(payload);
        break;
      case "$datatype":
        // `$datatype` is required in Homie v4. If it disappears, the property is no
        // longer publishable and any previous HA discovery must be cleaned up upstream.
        if (payload === "") {
          property.datatype = undefined;
        } else {
          property.datatype = normalizeLegacyDatatype(payload);
        }
        if (payload !== "" && !property.datatype) {
          warnings.push(
            `Ignored unsupported legacy Homie datatype '${payload}' for '${state.deviceId}/${nodeId}/${propertyId}'.`,
          );
        }
        break;
      case "$format":
        property.format = normalizeOptionalString(payload);
        break;
      case "$settable":
        property.settable = parseBoolean(payload);
        break;
      case "$retained":
        property.retained = parseBoolean(payload);
        break;
      case "$unit":
        property.unit = normalizeOptionalString(payload);
        break;
    }
  }

  private getOrCreateNode(state: LegacyDeviceState, nodeId: string): LegacyNodeState {
    let node = state.nodeState.get(nodeId);
    if (!node) {
      node = { arrayElementNames: new Map<number, string>(), properties: new Set<string>() };
      state.nodeState.set(nodeId, node);
    }
    return node;
  }

  private getOrCreateProperty(
    state: LegacyDeviceState,
    nodeId: string,
    propertyId: string,
  ): LegacyPropertyState {
    const key = propertyKey(nodeId, propertyId);
    let property = state.propertyState.get(key);
    if (!property) {
      property = {};
      state.propertyState.set(key, property);
    }
    return property;
  }

  private toNormalizedDevice(state: LegacyDeviceState): NormalizedHomieDevice | undefined {
    if (!state.majorVersion) {
      return undefined;
    }

    const properties: NormalizedHomieProperty[] = [];
    for (const nodeId of uniqueSorted(Array.from(state.nodes))) {
      const node = state.nodeState.get(nodeId);
      if (!node) {
        continue;
      }

      const expandedNodeIds = this.expandNodeIds(nodeId, node);
      for (const expandedNode of expandedNodeIds) {
        for (const propertyId of uniqueSorted(Array.from(node.properties))) {
          const metadata = state.propertyState.get(propertyKey(nodeId, propertyId));
          const datatype = metadata?.datatype ?? (state.majorVersion === 3 ? "string" : undefined);
          if (!datatype) {
            continue;
          }

          properties.push({
            deviceId: state.deviceId,
            nodeId: expandedNode.nodeId,
            propertyId,
            majorVersion: state.majorVersion,
            baseTopic: state.baseTopic,
            stateTopic: `${state.baseTopic}/${expandedNode.nodeId}/${propertyId}`,
            commandTopic: `${state.baseTopic}/${expandedNode.nodeId}/${propertyId}/set`,
            nodeName: expandedNode.name,
            nodeType: node.type,
            propertyName: metadata?.name,
            datatype,
            format: metadata?.format,
            settable: metadata?.settable ?? false,
            retained: metadata?.retained ?? true,
            unit: metadata?.unit,
          });
        }
      }
    }

    if (state.nodes.size > 0) {
      for (const statId of uniqueSorted(Array.from(state.stats))) {
        const stat = LEGACY_STATS_PROPERTIES[statId];
        if (!stat) {
          continue;
        }

        properties.push({
          deviceId: state.deviceId,
          nodeId: "stats",
          propertyId: statId,
          majorVersion: state.majorVersion,
          baseTopic: state.baseTopic,
          stateTopic: `${state.baseTopic}/$stats/${statId}`,
          commandTopic: `${state.baseTopic}/$stats/${statId}/set`,
          nodeName: "Stats",
          propertyName: stat.propertyName,
          datatype: stat.datatype,
          settable: false,
          retained: true,
          unit: stat.unit,
          entityCategory: "diagnostic",
          deviceClass: stat.deviceClass,
          stateClass: stat.stateClass,
        });
      }
    }

    if (properties.length === 0) {
      return undefined;
    }

    return {
      deviceId: state.deviceId,
      majorVersion: state.majorVersion,
      baseTopic: state.baseTopic,
      name: state.name,
      firmwareName: state.firmwareName,
      swVersion: state.firmwareVersion,
      mac: state.mac,
      properties,
    };
  }

  private expandNodeIds(
    nodeId: string,
    node: LegacyNodeState,
  ): Array<{ nodeId: string; name?: string }> {
    if (node.isArray && !node.arrayRange) {
      return [];
    }

    if (!node.arrayRange) {
      return [{ nodeId, name: node.name }];
    }

    const expandedNodes: Array<{ nodeId: string; name?: string }> = [];
    for (let index = node.arrayRange.start; index <= node.arrayRange.end; index += 1) {
      expandedNodes.push({
        nodeId: `${nodeId}_${index}`,
        name:
          node.arrayElementNames.get(index) ?? (node.name ? `${node.name} ${index}` : undefined),
      });
    }
    return expandedNodes;
  }
}
