#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { delimiter } from "node:path";

import { HomieHaDiscoveryMqttBridge, toEnabledVersions } from "./mqtt-adapter";
import { validateDiscoveryOverrides } from "./overrides";
import type { DiscoveryOverrideConfig, HomieHaDiscoveryOptions } from "./types";
import type { IClientOptions } from "mqtt";
import type { MqttBridgeLogger } from "./mqtt-adapter";
import type { MqttQoS } from "./subscriptions";

type BooleanPlatform = NonNullable<HomieHaDiscoveryOptions["defaultCommandableBooleanPlatform"]>;
type LogLevel = "silent" | "error" | "warn" | "info" | "debug";
type MqttProtocolVersion = 4 | 5;

export interface CliOptions {
  brokerUrl: string;
  homieDomain: string;
  legacyRoot: string;
  discoveryPrefix: string;
  idPrefix?: string;
  manufacturer?: string;
  model?: string;
  enableV3: boolean;
  enableV4: boolean;
  enableV5: boolean;
  includeStateSensor: boolean;
  includeAttributeDiagnostics: boolean;
  defaultCommandableBooleanPlatform: BooleanPlatform;
  subscriptionQos: MqttQoS;
  mqttProtocolVersion: MqttProtocolVersion;
  clientId?: string;
  username?: string;
  password?: string;
  caPaths: string[];
  certPath?: string;
  keyPath?: string;
  keyPassphrase?: string;
  rejectUnauthorized: boolean;
  overridesPath?: string;
  logLevel: LogLevel;
}

const HELP = `homie-home-assistant-discovery

Usage:
  homie-home-assistant-discovery --broker mqtt://localhost:1883 [options]

Options:
  --broker <url>              MQTT broker URL.
  --homie-domain <topic>      Homie v5 domain prefix. Default: homie
  --legacy-root <topic>       Homie v3/v4 root prefix. Default: homie
  --discovery-prefix <topic>  Home Assistant discovery prefix. Default: homeassistant
  --id-prefix <prefix>        Home Assistant object/unique id prefix. Default: homie
  --manufacturer <name>       Home Assistant device manufacturer.
  --model <name>              Home Assistant device model.
  --boolean-platform <type>   Boolean mapping: auto, switch, light, fan. Default: auto
  --subscription-qos <qos>    MQTT subscription QoS: 0, 1, 2. Default: 1
  --mqtt-version <version>    MQTT protocol version: 4 or 5. Default: 4
  --client-id <id>            MQTT client id.
  --username <user>           MQTT username.
  --password <password>       MQTT password.
  --ca <file>                 TLS CA certificate file. Can be repeated.
  --cert <file>               TLS client certificate file for mutual TLS.
  --key <file>                TLS client private key file for mutual TLS.
  --key-passphrase <value>    TLS client private key passphrase.
  --reject-unauthorized <bool> Verify broker TLS certificate. Default: true
  --overrides <file>          JSON discovery overrides file.
  --log-level <level>         silent, error, warn, info, debug. Default: info
  --disable-v3                Disable Homie v3 discovery.
  --disable-v4                Disable Homie v4 discovery.
  --disable-v5                Disable Homie v5 discovery.
  --no-state-sensor           Do not publish the diagnostic Homie State sensor.
  --no-attribute-diagnostics  Do not publish observed v5 $... attributes as diagnostics.
  --help                      Show this help.
`;

const takeValue = (args: string[], index: number, flag: string): string => {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
};

const parseBooleanEnv = (value: string | undefined, defaultValue: boolean): boolean => {
  if (value === undefined) {
    return defaultValue;
  }

  if (["1", "true", "yes", "on"].includes(value.toLowerCase())) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(value.toLowerCase())) {
    return false;
  }

  throw new Error(`Invalid boolean environment value '${value}'.`);
};

const parseSubscriptionQos = (value: string | undefined, source: string): MqttQoS => {
  if (value === undefined) {
    return 1;
  }

  const parsed = Number(value);
  if (parsed === 0 || parsed === 1 || parsed === 2) {
    return parsed;
  }

  throw new Error(`${source} must be 0, 1 or 2.`);
};

const parseMqttProtocolVersion = (
  value: string | undefined,
  source: string,
): MqttProtocolVersion => {
  if (value === undefined) {
    return 4;
  }

  const parsed = Number(value);
  if (parsed === 4 || parsed === 5) {
    return parsed;
  }

  throw new Error(`${source} must be 4 or 5.`);
};

const parseBooleanPlatform = (value: string | undefined, source: string): BooleanPlatform => {
  if (value === undefined) {
    return "auto";
  }

  if (value === "auto" || value === "switch" || value === "light" || value === "fan") {
    return value;
  }

  throw new Error(`${source} must be auto, switch, light or fan.`);
};

const parseLogLevel = (value: string | undefined, source: string): LogLevel => {
  if (value === undefined) {
    return "info";
  }

  if (
    value === "silent" ||
    value === "error" ||
    value === "warn" ||
    value === "info" ||
    value === "debug"
  ) {
    return value;
  }

  throw new Error(`${source} must be silent, error, warn, info or debug.`);
};

const parsePathListEnv = (value: string | undefined): string[] =>
  value === undefined ? [] : value.split(delimiter).filter((entry) => entry.length > 0);

export const createLogger = (level: LogLevel): MqttBridgeLogger => {
  const rank: Record<Exclude<LogLevel, "silent">, number> = {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3,
  };
  if (level === "silent") {
    return {};
  }

  const maxRank = rank[level];
  return {
    error: maxRank >= rank.error ? console.error.bind(console) : undefined,
    warn: maxRank >= rank.warn ? console.warn.bind(console) : undefined,
    info: maxRank >= rank.info ? console.info.bind(console) : undefined,
    debug: maxRank >= rank.debug ? console.debug.bind(console) : undefined,
  };
};

export const parseCliArgs = (args: string[], env: NodeJS.ProcessEnv = process.env): CliOptions => {
  const options: CliOptions = {
    brokerUrl: env.HOMIE_HA_MQTT_URL ?? "mqtt://localhost:1883",
    homieDomain: env.HOMIE_HA_HOMIE_DOMAIN ?? "homie",
    legacyRoot: env.HOMIE_HA_LEGACY_ROOT ?? "homie",
    discoveryPrefix: env.HOMIE_HA_DISCOVERY_PREFIX ?? "homeassistant",
    idPrefix: env.HOMIE_HA_ID_PREFIX,
    manufacturer: env.HOMIE_HA_MANUFACTURER,
    model: env.HOMIE_HA_MODEL,
    enableV3: true,
    enableV4: true,
    enableV5: true,
    includeStateSensor: parseBooleanEnv(env.HOMIE_HA_INCLUDE_STATE_SENSOR, true),
    includeAttributeDiagnostics: parseBooleanEnv(env.HOMIE_HA_INCLUDE_ATTRIBUTE_DIAGNOSTICS, true),
    defaultCommandableBooleanPlatform: parseBooleanPlatform(
      env.HOMIE_HA_BOOLEAN_PLATFORM,
      "HOMIE_HA_BOOLEAN_PLATFORM",
    ),
    subscriptionQos: parseSubscriptionQos(
      env.HOMIE_HA_SUBSCRIPTION_QOS,
      "HOMIE_HA_SUBSCRIPTION_QOS",
    ),
    mqttProtocolVersion: parseMqttProtocolVersion(
      env.HOMIE_HA_MQTT_VERSION,
      "HOMIE_HA_MQTT_VERSION",
    ),
    clientId: env.HOMIE_HA_CLIENT_ID,
    username: env.HOMIE_HA_USERNAME,
    password: env.HOMIE_HA_PASSWORD,
    caPaths: parsePathListEnv(env.HOMIE_HA_MQTT_CA),
    certPath: env.HOMIE_HA_MQTT_CERT,
    keyPath: env.HOMIE_HA_MQTT_KEY,
    keyPassphrase: env.HOMIE_HA_MQTT_KEY_PASSPHRASE,
    rejectUnauthorized: parseBooleanEnv(env.HOMIE_HA_MQTT_REJECT_UNAUTHORIZED, true),
    overridesPath: env.HOMIE_HA_OVERRIDES,
    logLevel: parseLogLevel(env.HOMIE_HA_LOG_LEVEL, "HOMIE_HA_LOG_LEVEL"),
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--help":
        process.stdout.write(HELP);
        process.exit(0);
        break;
      case "--broker":
        options.brokerUrl = takeValue(args, index, arg);
        index += 1;
        break;
      case "--homie-domain":
        options.homieDomain = takeValue(args, index, arg);
        index += 1;
        break;
      case "--legacy-root":
        options.legacyRoot = takeValue(args, index, arg);
        index += 1;
        break;
      case "--discovery-prefix":
        options.discoveryPrefix = takeValue(args, index, arg);
        index += 1;
        break;
      case "--id-prefix":
        options.idPrefix = takeValue(args, index, arg);
        index += 1;
        break;
      case "--manufacturer":
        options.manufacturer = takeValue(args, index, arg);
        index += 1;
        break;
      case "--model":
        options.model = takeValue(args, index, arg);
        index += 1;
        break;
      case "--boolean-platform":
        options.defaultCommandableBooleanPlatform = parseBooleanPlatform(
          takeValue(args, index, arg),
          arg,
        );
        index += 1;
        break;
      case "--subscription-qos":
        options.subscriptionQos = parseSubscriptionQos(takeValue(args, index, arg), arg);
        index += 1;
        break;
      case "--mqtt-version":
        options.mqttProtocolVersion = parseMqttProtocolVersion(takeValue(args, index, arg), arg);
        index += 1;
        break;
      case "--client-id":
        options.clientId = takeValue(args, index, arg);
        index += 1;
        break;
      case "--username":
        options.username = takeValue(args, index, arg);
        index += 1;
        break;
      case "--password":
        options.password = takeValue(args, index, arg);
        index += 1;
        break;
      case "--ca":
        options.caPaths.push(takeValue(args, index, arg));
        index += 1;
        break;
      case "--cert":
        options.certPath = takeValue(args, index, arg);
        index += 1;
        break;
      case "--key":
        options.keyPath = takeValue(args, index, arg);
        index += 1;
        break;
      case "--key-passphrase":
        options.keyPassphrase = takeValue(args, index, arg);
        index += 1;
        break;
      case "--reject-unauthorized":
        options.rejectUnauthorized = parseBooleanEnv(takeValue(args, index, arg), true);
        index += 1;
        break;
      case "--overrides":
        options.overridesPath = takeValue(args, index, arg);
        index += 1;
        break;
      case "--log-level":
        options.logLevel = parseLogLevel(takeValue(args, index, arg), arg);
        index += 1;
        break;
      case "--disable-v3":
        options.enableV3 = false;
        break;
      case "--disable-v4":
        options.enableV4 = false;
        break;
      case "--disable-v5":
        options.enableV5 = false;
        break;
      case "--no-state-sensor":
        options.includeStateSensor = false;
        break;
      case "--no-attribute-diagnostics":
        options.includeAttributeDiagnostics = false;
        break;
      default:
        throw new Error(`Unknown argument '${arg}'.`);
    }
  }

  if (!options.enableV3 && !options.enableV4 && !options.enableV5) {
    throw new Error("At least one Homie version must be enabled.");
  }

  if ((options.certPath && !options.keyPath) || (!options.certPath && options.keyPath)) {
    throw new Error("--cert and --key must be used together for mutual TLS.");
  }

  if (options.keyPassphrase && !options.keyPath) {
    throw new Error("--key-passphrase requires --key.");
  }

  return options;
};

export const loadOverrides = async (
  overridesPath: string | undefined,
): Promise<DiscoveryOverrideConfig | undefined> => {
  if (!overridesPath) {
    return undefined;
  }

  const parsed: unknown = JSON.parse(await readFile(overridesPath, "utf8"));
  return validateDiscoveryOverrides(parsed);
};

export const loadMqttOptions = async (options: CliOptions): Promise<IClientOptions> => {
  const mqttOptions: IClientOptions & { passphrase?: string } = {
    clientId: options.clientId,
    username: options.username,
    password: options.password,
    protocolVersion: options.mqttProtocolVersion,
    rejectUnauthorized: options.rejectUnauthorized,
  };

  if (options.caPaths.length > 0) {
    mqttOptions.ca = await Promise.all(options.caPaths.map((path) => readFile(path)));
  }

  if (options.certPath) {
    mqttOptions.cert = await readFile(options.certPath);
  }

  if (options.keyPath) {
    mqttOptions.key = await readFile(options.keyPath);
  }

  if (options.keyPassphrase) {
    mqttOptions.passphrase = options.keyPassphrase;
  }

  return mqttOptions;
};

export const main = async (): Promise<void> => {
  const options = parseCliArgs(process.argv.slice(2));
  const bridge = new HomieHaDiscoveryMqttBridge({
    brokerUrl: options.brokerUrl,
    homieDomain: options.homieDomain,
    legacyRoot: options.legacyRoot,
    discoveryPrefix: options.discoveryPrefix,
    idPrefix: options.idPrefix,
    manufacturer: options.manufacturer,
    model: options.model,
    enabledVersions: toEnabledVersions(options),
    includeStateSensor: options.includeStateSensor,
    includeAttributeDiagnostics: options.includeAttributeDiagnostics,
    defaultCommandableBooleanPlatform: options.defaultCommandableBooleanPlatform,
    subscriptionQos: options.subscriptionQos,
    overrides: await loadOverrides(options.overridesPath),
    mqttOptions: await loadMqttOptions(options),
    logger: createLogger(options.logLevel),
  });

  await bridge.start();

  const stop = async () => {
    await bridge.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void stop();
  });
  process.on("SIGTERM", () => {
    void stop();
  });
};

if (require.main === module) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
}
