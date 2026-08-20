import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { createLogger, loadMqttOptions, loadOverrides, parseCliArgs } from "../cli";

describe("CLI argument parsing", () => {
  it("uses standalone defaults", () => {
    expect(parseCliArgs([], {})).toEqual(
      expect.objectContaining({
        brokerUrl: "mqtt://localhost:1883",
        homieDomain: "homie",
        legacyRoot: "homie",
        discoveryPrefix: "homeassistant",
        enableV3: true,
        enableV4: true,
        enableV5: true,
        includeStateSensor: true,
        includeAttributeDiagnostics: true,
        defaultCommandableBooleanPlatform: "auto",
        subscriptionQos: 1,
        mqttProtocolVersion: 4,
        caPaths: [],
        rejectUnauthorized: true,
      }),
    );
  });

  it("parses production-oriented options", () => {
    expect(
      parseCliArgs(
        [
          "--broker",
          "mqtts://mqtt.example.test:8883",
          "--homie-domain",
          "building/homie",
          "--legacy-root",
          "legacy/homie",
          "--discovery-prefix",
          "ha",
          "--id-prefix",
          "fleet",
          "--manufacturer",
          "Acme",
          "--model",
          "Bridge",
          "--boolean-platform",
          "light",
          "--subscription-qos",
          "2",
          "--mqtt-version",
          "5",
          "--client-id",
          "homie-ha",
          "--username",
          "user",
          "--password",
          "secret",
          "--ca",
          "./ca-one.pem",
          "--ca",
          "./ca-two.pem",
          "--cert",
          "./client-cert.pem",
          "--key",
          "./client-key.pem",
          "--key-passphrase",
          "top-secret",
          "--reject-unauthorized",
          "false",
          "--overrides",
          "./overrides.json",
          "--log-level",
          "debug",
          "--disable-v3",
          "--no-state-sensor",
          "--no-attribute-diagnostics",
        ],
        {},
      ),
    ).toEqual({
      brokerUrl: "mqtts://mqtt.example.test:8883",
      homieDomain: "building/homie",
      legacyRoot: "legacy/homie",
      discoveryPrefix: "ha",
      idPrefix: "fleet",
      manufacturer: "Acme",
      model: "Bridge",
      enableV3: false,
      enableV4: true,
      enableV5: true,
      includeStateSensor: false,
      includeAttributeDiagnostics: false,
      defaultCommandableBooleanPlatform: "light",
      subscriptionQos: 2,
      mqttProtocolVersion: 5,
      clientId: "homie-ha",
      username: "user",
      password: "secret",
      caPaths: ["./ca-one.pem", "./ca-two.pem"],
      certPath: "./client-cert.pem",
      keyPath: "./client-key.pem",
      keyPassphrase: "top-secret",
      rejectUnauthorized: false,
      overridesPath: "./overrides.json",
      logLevel: "debug",
    });
  });

  it("parses environment options", () => {
    expect(
      parseCliArgs([], {
        HOMIE_HA_MQTT_URL: "mqtts://mqtt.example.test:8883",
        HOMIE_HA_ID_PREFIX: "fleet",
        HOMIE_HA_INCLUDE_STATE_SENSOR: "false",
        HOMIE_HA_INCLUDE_ATTRIBUTE_DIAGNOSTICS: "false",
        HOMIE_HA_BOOLEAN_PLATFORM: "fan",
        HOMIE_HA_SUBSCRIPTION_QOS: "0",
        HOMIE_HA_MQTT_VERSION: "5",
        HOMIE_HA_MQTT_CA: `./ca-one.pem${delimiter}./ca-two.pem`,
        HOMIE_HA_MQTT_CERT: "./client-cert.pem",
        HOMIE_HA_MQTT_KEY: "./client-key.pem",
        HOMIE_HA_MQTT_KEY_PASSPHRASE: "secret",
        HOMIE_HA_MQTT_REJECT_UNAUTHORIZED: "false",
        HOMIE_HA_LOG_LEVEL: "warn",
      }),
    ).toEqual(
      expect.objectContaining({
        idPrefix: "fleet",
        includeStateSensor: false,
        includeAttributeDiagnostics: false,
        defaultCommandableBooleanPlatform: "fan",
        subscriptionQos: 0,
        mqttProtocolVersion: 5,
        caPaths: ["./ca-one.pem", "./ca-two.pem"],
        certPath: "./client-cert.pem",
        keyPath: "./client-key.pem",
        keyPassphrase: "secret",
        rejectUnauthorized: false,
        logLevel: "warn",
      }),
    );
  });

  it("rejects invalid enum values", () => {
    expect(() => parseCliArgs(["--boolean-platform", "cover"], {})).toThrow(
      /must be auto, switch, light or fan/,
    );
    expect(() => parseCliArgs(["--subscription-qos", "3"], {})).toThrow(/must be 0, 1 or 2/);
    expect(() => parseCliArgs(["--mqtt-version", "6"], {})).toThrow(/must be 4 or 5/);
    expect(() => parseCliArgs(["--log-level", "trace"], {})).toThrow(
      /must be silent, error, warn, info or debug/,
    );
  });

  it("rejects missing option values and unknown flags", () => {
    expect(() => parseCliArgs(["--broker"], {})).toThrow(/--broker requires a value/);
    expect(() => parseCliArgs(["--homie-domain", "--legacy-root"], {})).toThrow(
      /--homie-domain requires a value/,
    );
    expect(() => parseCliArgs(["--unexpected"], {})).toThrow(/Unknown argument '--unexpected'/);
  });

  it("rejects invalid environment values", () => {
    expect(() => parseCliArgs([], { HOMIE_HA_INCLUDE_STATE_SENSOR: "maybe" })).toThrow(
      /Invalid boolean environment value/,
    );
    expect(() => parseCliArgs([], { HOMIE_HA_INCLUDE_ATTRIBUTE_DIAGNOSTICS: "maybe" })).toThrow(
      /Invalid boolean environment value/,
    );
    expect(() => parseCliArgs([], { HOMIE_HA_SUBSCRIPTION_QOS: "high" })).toThrow(
      /HOMIE_HA_SUBSCRIPTION_QOS must be 0, 1 or 2/,
    );
    expect(() => parseCliArgs([], { HOMIE_HA_MQTT_VERSION: "6" })).toThrow(
      /HOMIE_HA_MQTT_VERSION must be 4 or 5/,
    );
    expect(() => parseCliArgs([], { HOMIE_HA_MQTT_REJECT_UNAUTHORIZED: "maybe" })).toThrow(
      /Invalid boolean environment value/,
    );
  });

  it("accepts MQTT.js TCP aliases and lets CLI arguments override an invalid broker env", () => {
    expect(parseCliArgs(["--broker", " tcp://broker.example.test:1883 "], {})).toEqual(
      expect.objectContaining({ brokerUrl: "tcp://broker.example.test:1883" }),
    );
    expect(parseCliArgs(["--broker", "tls://broker.example.test:8883"], {})).toEqual(
      expect.objectContaining({ brokerUrl: "tls://broker.example.test:8883" }),
    );
    expect(
      parseCliArgs(["--broker", "mqtt://broker.example.test:1883"], {
        HOMIE_HA_MQTT_URL: "not a URL",
      }),
    ).toEqual(expect.objectContaining({ brokerUrl: "mqtt://broker.example.test:1883" }));
  });

  it("accepts TLS files with the tls:// alias and rejects unsupported broker schemes", () => {
    expect(() =>
      parseCliArgs(["--broker", "tls://broker.example.test:8883", "--ca", "./ca.pem"], {}),
    ).not.toThrow();
    expect(() => parseCliArgs(["--broker", "http://broker.example.test"], {})).toThrow(
      /must use a supported protocol/,
    );
  });

  it("rejects configurations with all Homie versions disabled", () => {
    expect(() => parseCliArgs(["--disable-v3", "--disable-v4", "--disable-v5"], {})).toThrow(
      /At least one Homie version/,
    );
  });

  it("rejects incomplete mutual TLS options", () => {
    expect(() => parseCliArgs(["--cert", "./client.pem"], {})).toThrow(
      /--cert and --key must be used together/,
    );
    expect(() => parseCliArgs(["--key", "./client.key"], {})).toThrow(
      /--cert and --key must be used together/,
    );
    expect(() => parseCliArgs(["--key-passphrase", "secret"], {})).toThrow(
      /--key-passphrase requires --key/,
    );
  });

  it("creates filtered loggers for daemon output", () => {
    expect(createLogger("silent")).toEqual({});
    expect(createLogger("error")).toEqual(
      expect.objectContaining({
        error: expect.any(Function),
        warn: undefined,
        info: undefined,
        debug: undefined,
      }),
    );
    expect(createLogger("warn")).toEqual(
      expect.objectContaining({
        error: expect.any(Function),
        warn: expect.any(Function),
        info: undefined,
        debug: undefined,
      }),
    );
    expect(createLogger("debug")).toEqual(
      expect.objectContaining({
        error: expect.any(Function),
        warn: expect.any(Function),
        info: expect.any(Function),
        debug: expect.any(Function),
      }),
    );
  });

  it("loads and validates discovery overrides from disk", async () => {
    const directory = await mkdtemp(join(tmpdir(), "homie-ha-cli-"));
    const file = join(directory, "overrides.json");
    await writeFile(
      file,
      JSON.stringify({
        deviceDefaults: {
          objectId: "acme_{deviceId}",
        },
        namedNodeState: {
          platform: "light",
          objectId: "acme_{deviceId}_{nodeId}",
        },
        devices: {
          kitchen: {
            objectId: "acme_kitchen",
            nodeNames: {
              relay: "Kitchen Ceiling",
              fan: {
                name: "Extractor Fan",
                platform: "fan",
              },
            },
          },
        },
      }),
    );

    try {
      await expect(loadOverrides(undefined)).resolves.toBeUndefined();
      await expect(loadOverrides(file)).resolves.toEqual({
        deviceDefaults: {
          objectId: "acme_{deviceId}",
        },
        namedNodeState: {
          platform: "light",
          objectId: "acme_{deviceId}_{nodeId}",
        },
        devices: {
          kitchen: {
            objectId: "acme_kitchen",
            nodeNames: {
              relay: "Kitchen Ceiling",
              fan: "Extractor Fan",
            },
            nodes: {
              relay: {
                name: "Kitchen Ceiling",
              },
              fan: {
                name: "Extractor Fan",
                properties: {
                  state: {
                    name: "Extractor Fan",
                    platform: "fan",
                  },
                },
              },
            },
          },
        },
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("loads MQTT TLS files for the standalone adapter", async () => {
    const directory = await mkdtemp(join(tmpdir(), "homie-ha-mqtt-"));
    const caFile = join(directory, "ca.pem");
    const certFile = join(directory, "client.pem");
    const keyFile = join(directory, "client.key");
    await writeFile(caFile, "ca");
    await writeFile(certFile, "cert");
    await writeFile(keyFile, "key");

    try {
      const options = parseCliArgs(
        [
          "--mqtt-version",
          "5",
          "--broker",
          "mqtts://mqtt.example.test:8883",
          "--ca",
          caFile,
          "--cert",
          certFile,
          "--key",
          keyFile,
          "--key-passphrase",
          "secret",
          "--reject-unauthorized",
          "false",
        ],
        {},
      );

      await expect(loadMqttOptions(options)).resolves.toEqual(
        expect.objectContaining({
          protocolVersion: 5,
          ca: [Buffer.from("ca")],
          cert: Buffer.from("cert"),
          key: Buffer.from("key"),
          passphrase: "secret",
          rejectUnauthorized: false,
        }),
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects TLS certificate options for a non-TLS broker URL", () => {
    expect(() =>
      parseCliArgs(
        [
          "--ca",
          "/tmp/ca.pem",
          "--cert",
          "/tmp/cert.pem",
          "--key",
          "/tmp/key.pem",
          "--broker",
          "mqtt://localhost",
        ],
        {},
      ),
    ).toThrow(
      /TLS certificate configuration is only valid for mqtts:\/\/, tls:\/\/ or wss:\/\/ broker URLs/,
    );
  });
});
