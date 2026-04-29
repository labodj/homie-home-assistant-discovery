import type { HomieDatatype, NormalizedHomieDevice, NormalizedHomieProperty } from "./types";
import { HOMIE_ID_PATTERN, isRecord, normalizeOptionalString } from "./utils";

export type ParseHomieV5DescriptionResult =
  | { ok: true; device: NormalizedHomieDevice; warnings: string[] }
  | { ok: false; shouldCleanup?: boolean; warnings: string[] };

const HOMIE_V5_DATATYPES = new Set<HomieDatatype>([
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

const normalizeDatatype = (value: unknown): HomieDatatype | null => {
  const normalized = normalizeOptionalString(value)?.toLowerCase();
  if (!normalized || !HOMIE_V5_DATATYPES.has(normalized as HomieDatatype)) {
    return null;
  }
  return normalized as HomieDatatype;
};

const normalizeStringArray = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized = value
    .map((entry) => normalizeOptionalString(entry))
    .filter((entry): entry is string => entry !== undefined);
  return normalized.length > 0 ? normalized : undefined;
};

export function parseHomieV5Description(
  deviceId: string,
  baseTopic: string,
  payload: string,
): ParseHomieV5DescriptionResult {
  let parsedPayload: unknown;
  try {
    parsedPayload = JSON.parse(payload);
  } catch {
    return {
      ok: false,
      warnings: [`Ignored Homie v5 $description for '${deviceId}' because it is not valid JSON.`],
    };
  }

  if (!isRecord(parsedPayload)) {
    return {
      ok: false,
      warnings: [
        `Ignored Homie v5 $description for '${deviceId}' because the payload is not an object.`,
      ],
    };
  }

  const homieVersion = normalizeOptionalString(parsedPayload.homie);
  if (!homieVersion || !/^5\.\d+$/.test(homieVersion)) {
    return {
      ok: false,
      warnings: [
        `Ignored Homie $description for '${deviceId}' because homie='${String(
          parsedPayload.homie,
        )}' is not supported; expected a 5.x description.`,
      ],
    };
  }

  const warnings: string[] = [];
  const properties: NormalizedHomieProperty[] = [];
  // Homie v5 is designed for progressive enhancement through unknown fields and
  // extensions. The parser only validates fields needed for stable HA discovery.
  const rawNodes = isRecord(parsedPayload.nodes) ? parsedPayload.nodes : {};
  const extensions = normalizeStringArray(parsedPayload.extensions);

  for (const [nodeId, rawNode] of Object.entries(rawNodes)) {
    if (!HOMIE_ID_PATTERN.test(nodeId)) {
      warnings.push(`Ignored Homie v5 node '${deviceId}/${nodeId}' because the id is invalid.`);
      continue;
    }

    if (!isRecord(rawNode)) {
      warnings.push(`Ignored Homie v5 node '${deviceId}/${nodeId}' because it is not an object.`);
      continue;
    }

    const rawProperties = isRecord(rawNode.properties) ? rawNode.properties : {};
    for (const [propertyId, rawProperty] of Object.entries(rawProperties)) {
      if (!HOMIE_ID_PATTERN.test(propertyId)) {
        warnings.push(
          `Ignored Homie v5 property '${deviceId}/${nodeId}/${propertyId}' because the id is invalid.`,
        );
        continue;
      }

      if (!isRecord(rawProperty)) {
        warnings.push(
          `Ignored Homie v5 property '${deviceId}/${nodeId}/${propertyId}' because it is not an object.`,
        );
        continue;
      }

      const datatype = normalizeDatatype(rawProperty.datatype);
      if (!datatype) {
        warnings.push(
          `Ignored Homie v5 property '${deviceId}/${nodeId}/${propertyId}' because datatype is missing or unsupported.`,
        );
        continue;
      }

      properties.push({
        deviceId,
        nodeId,
        propertyId,
        majorVersion: 5,
        baseTopic,
        stateTopic: `${baseTopic}/${nodeId}/${propertyId}`,
        commandTopic: `${baseTopic}/${nodeId}/${propertyId}/set`,
        nodeName: normalizeOptionalString(rawNode.name),
        nodeType: normalizeOptionalString(rawNode.type),
        propertyName: normalizeOptionalString(rawProperty.name),
        datatype,
        format: normalizeOptionalString(rawProperty.format),
        settable: rawProperty.settable === true,
        retained: rawProperty.retained === false ? false : true,
        unit: normalizeOptionalString(rawProperty.unit),
      });
    }
  }

  if (properties.length === 0) {
    return {
      ok: false,
      shouldCleanup: true,
      warnings: [
        ...warnings,
        `Ignored Homie v5 $description for '${deviceId}' because it contains no valid properties.`,
      ],
    };
  }

  properties.sort((left, right) => {
    const leftKey = `${left.nodeId}/${left.propertyId}`;
    const rightKey = `${right.nodeId}/${right.propertyId}`;
    return leftKey.localeCompare(rightKey);
  });

  const version =
    typeof parsedPayload.version === "number" && Number.isInteger(parsedPayload.version)
      ? parsedPayload.version
      : undefined;
  if (version === undefined) {
    warnings.push(`Accepted Homie v5 $description for '${deviceId}' without integer version.`);
  }

  return {
    ok: true,
    device: {
      deviceId,
      majorVersion: 5,
      baseTopic,
      name: normalizeOptionalString(parsedPayload.name),
      type: normalizeOptionalString(parsedPayload.type),
      root: normalizeOptionalString(parsedPayload.root),
      parent: normalizeOptionalString(parsedPayload.parent),
      extensions,
      version,
      properties,
    },
    warnings,
  };
}
