import { parseHomieTopic, parseMajorVersion } from "../topic";

describe("Homie topic parser", () => {
  it("parses major versions from Homie version payloads", () => {
    expect(parseMajorVersion("3.0.1")).toBe(3);
    expect(parseMajorVersion("4.0.0")).toBe(4);
    expect(parseMajorVersion("5.1")).toBe(5);
    expect(parseMajorVersion("6.0")).toBeNull();
    expect(parseMajorVersion("")).toBeNull();
  });

  it("rejects empty topic segments", () => {
    expect(
      parseHomieTopic("homie//device/$homie", { homieDomain: "homie", legacyRoot: "homie" }),
    ).toBeNull();
    expect(
      parseHomieTopic("/homie/5/device/$description", {
        homieDomain: "homie",
        legacyRoot: "homie",
      }),
    ).toBeNull();
  });

  it("parses multi-segment v5, future-major control and legacy topics", () => {
    expect(
      parseHomieTopic("building/homie/5/kitchen/$description", {
        homieDomain: "building/homie",
        legacyRoot: "legacy/homie",
      }),
    ).toEqual({
      kind: "v5",
      domain: "building/homie",
      deviceId: "kitchen",
      baseTopic: "building/homie/5/kitchen",
      suffix: ["$description"],
    });

    expect(
      parseHomieTopic("building/homie/6/kitchen/$state", {
        homieDomain: "building/homie",
        legacyRoot: "legacy/homie",
      }),
    ).toEqual({
      kind: "unsupported-version",
      domain: "building/homie",
      majorVersion: "6",
      deviceId: "kitchen",
      baseTopic: "building/homie/6/kitchen",
      suffix: ["$state"],
    });

    expect(
      parseHomieTopic("legacy/homie/kitchen/relay/state/$datatype", {
        homieDomain: "building/homie",
        legacyRoot: "legacy/homie",
      }),
    ).toEqual({
      kind: "legacy",
      root: "legacy/homie",
      deviceId: "kitchen",
      baseTopic: "legacy/homie/kitchen",
      suffix: ["relay", "state", "$datatype"],
    });
  });

  it("does not classify future-major property topics as supported v5 control topics", () => {
    expect(
      parseHomieTopic("homie/6/kitchen/relay/state", {
        homieDomain: "homie",
        legacyRoot: "legacy",
      }),
    ).toBeNull();
  });
});
