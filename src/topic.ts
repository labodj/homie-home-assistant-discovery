import type { HomieMajorVersion } from "./types";

export type ParsedHomieTopic =
  | {
      kind: "v5";
      domain: string;
      deviceId: string;
      baseTopic: string;
      suffix: string[];
    }
  | {
      kind: "unsupported-version";
      domain: string;
      majorVersion: string;
      deviceId: string;
      baseTopic: string;
      suffix: string[];
    }
  | {
      kind: "legacy";
      root: string;
      deviceId: string;
      baseTopic: string;
      suffix: string[];
    };

export interface TopicParseOptions {
  homieDomain: string;
  legacyRoot: string;
}

export const parseMajorVersion = (payload: string): HomieMajorVersion | null => {
  if (payload.startsWith("3.")) {
    return 3;
  }
  if (payload.startsWith("4.")) {
    return 4;
  }
  if (payload.startsWith("5.")) {
    return 5;
  }
  return null;
};

export const parseHomieTopic = (
  topic: string,
  { homieDomain, legacyRoot }: TopicParseOptions,
): ParsedHomieTopic | null => {
  const segments = topic.split("/");
  if (segments.some((segment) => segment.length === 0)) {
    return null;
  }

  const homieDomainSegments = homieDomain.split("/");
  if (
    segments.length >= homieDomainSegments.length + 3 &&
    startsWithSegments(segments, homieDomainSegments) &&
    segments[homieDomainSegments.length] === "5"
  ) {
    const deviceSegmentIndex = homieDomainSegments.length + 1;
    return {
      kind: "v5",
      domain: homieDomain,
      deviceId: segments[deviceSegmentIndex],
      baseTopic: segments.slice(0, deviceSegmentIndex + 1).join("/"),
      suffix: segments.slice(deviceSegmentIndex + 1),
    };
  }

  const possibleVersionSegment = segments[homieDomainSegments.length];
  const possibleVersionedDeviceSegmentIndex = homieDomainSegments.length + 1;
  const possibleVersionedSuffix = segments.slice(possibleVersionedDeviceSegmentIndex + 1);
  const isFutureVersionControlTopic =
    possibleVersionedSuffix.length === 1 &&
    (possibleVersionedSuffix[0] === "$description" || possibleVersionedSuffix[0] === "$state");
  if (
    segments.length >= homieDomainSegments.length + 3 &&
    startsWithSegments(segments, homieDomainSegments) &&
    /^\d+$/.test(possibleVersionSegment) &&
    isFutureVersionControlTopic
  ) {
    return {
      kind: "unsupported-version",
      domain: homieDomain,
      majorVersion: possibleVersionSegment,
      deviceId: segments[possibleVersionedDeviceSegmentIndex],
      baseTopic: segments.slice(0, possibleVersionedDeviceSegmentIndex + 1).join("/"),
      suffix: possibleVersionedSuffix,
    };
  }

  const legacyRootSegments = legacyRoot.split("/");
  if (
    segments.length >= legacyRootSegments.length + 2 &&
    startsWithSegments(segments, legacyRootSegments)
  ) {
    const deviceSegmentIndex = legacyRootSegments.length;
    return {
      kind: "legacy",
      root: legacyRoot,
      deviceId: segments[deviceSegmentIndex],
      baseTopic: segments.slice(0, deviceSegmentIndex + 1).join("/"),
      suffix: segments.slice(deviceSegmentIndex + 1),
    };
  }

  return null;
};

const startsWithSegments = (segments: string[], prefixSegments: string[]): boolean =>
  prefixSegments.every((segment, index) => segments[index] === segment);
