import type { HomieMajorVersion } from "./types";

export type MqttQoS = 0 | 1 | 2;

export interface HomieSubscriptionOptions {
  homieDomain?: string;
  legacyRoot?: string;
  enabledVersions?: HomieMajorVersion[];
  includeAttributeDiagnostics?: boolean;
  qos?: MqttQoS;
}

export type HomieSubscriptionMap = Record<string, { qos: MqttQoS }>;

export const getEnabledHomieVersions = (
  enabledVersions: HomieMajorVersion[] | undefined,
): ReadonlySet<HomieMajorVersion> => new Set(enabledVersions ?? [3, 4, 5]);

const topicPrefixCovers = (coveringPrefix: string, coveredPrefix: string): boolean =>
  coveredPrefix === coveringPrefix || coveredPrefix.startsWith(`${coveringPrefix}/`);

export const buildHomieMqttSubscriptions = ({
  homieDomain = "homie",
  legacyRoot = "homie",
  enabledVersions,
  includeAttributeDiagnostics = true,
  qos = 1,
}: HomieSubscriptionOptions = {}): HomieSubscriptionMap => {
  const versions = getEnabledHomieVersions(enabledVersions);
  const topics = new Map<string, { qos: MqttQoS }>();
  const hasLegacy = versions.has(3) || versions.has(4);
  const legacyCoversV5 = hasLegacy && topicPrefixCovers(legacyRoot, homieDomain);

  if (versions.has(5) && !legacyCoversV5) {
    if (includeAttributeDiagnostics) {
      topics.set(`${homieDomain}/5/+/#`, { qos });
    } else {
      topics.set(`${homieDomain}/5/+/$state`, { qos });
      topics.set(`${homieDomain}/5/+/$description`, { qos });
    }
  }

  if (hasLegacy) {
    topics.set(`${legacyRoot}/#`, { qos });
  }

  return Object.fromEntries(
    Array.from(topics.entries()).sort(([left], [right]) => left.localeCompare(right)),
  );
};
