# Homie Home Assistant Discovery

[![npm](https://img.shields.io/npm/v/homie-home-assistant-discovery.svg)](https://www.npmjs.com/package/homie-home-assistant-discovery)
[![npm downloads](https://img.shields.io/npm/dm/homie-home-assistant-discovery.svg)](https://www.npmjs.com/package/homie-home-assistant-discovery)
[![CI](https://github.com/labodj/homie-home-assistant-discovery/actions/workflows/ci.yaml/badge.svg?branch=main)](https://github.com/labodj/homie-home-assistant-discovery/actions/workflows/ci.yaml)
[![Node.js](https://img.shields.io/node/v/homie-home-assistant-discovery.svg)](https://www.npmjs.com/package/homie-home-assistant-discovery)
[![License](https://img.shields.io/github/license/labodj/homie-home-assistant-discovery.svg)](https://github.com/labodj/homie-home-assistant-discovery/blob/main/LICENSE)

Standalone Homie MQTT to Home Assistant MQTT discovery bridge.

Homie devices already publish structured metadata on MQTT. Home Assistant already
knows how to discover MQTT entities. This package connects the two conventions:
it watches Homie device metadata, builds stable Home Assistant discovery
payloads, and publishes retained MQTT configuration messages.

Use it as a small standalone MQTT daemon, or embed the TypeScript core in another
tool such as a Node-RED node, gateway, test harness or custom automation service.

## Start Here

- If you want a ready-to-run bridge, use [Standalone daemon](#standalone-daemon).
- If you want to integrate the mapper in code, use [Library usage](#library-usage).
- If Home Assistant needs different entity names, icons or platforms, read
  [Overrides](#overrides).
- If you need exact mapping details, read
  [Home Assistant discovery mapping](https://github.com/labodj/homie-home-assistant-discovery/blob/main/docs/HOME_ASSISTANT_DISCOVERY.md).
- If you need Homie version details, read
  [Homie compatibility](https://github.com/labodj/homie-home-assistant-discovery/blob/main/docs/HOMIE_COMPATIBILITY.md).

## Key Features

- **Homie v3.0.1, v4.0.0 and v5.x support**: handles retained legacy topic
  metadata and v5 `$description` documents.
- **Home Assistant MQTT discovery**: emits retained discovery payloads with
  deterministic IDs and stable cleanup behavior.
- **Extension-aware without hard-coded ecosystems**: observed v5 `$...`
  attribute topics can become diagnostic entities through conservative,
  extension-agnostic inference.
- **Safe automatic mapping**: maps every supported Homie datatype to a practical
  Home Assistant MQTT entity without guessing high-level semantics that Homie did
  not declare.
- **Granular overrides**: ordered rules and exact device/property overrides can
  adjust platforms, names, icons, object IDs, payloads, units, diagnostics and
  raw Home Assistant discovery metadata.
- **Embeddable core**: the `HomieHaDiscoveryBridge` class accepts MQTT-like
  messages and returns publish-ready MQTT discovery messages.
- **Standalone MQTT adapter**: the CLI can connect directly to a broker through
  MQTT.js.
- **Strict quality gate**: TypeScript, ESLint, Prettier, Knip, package
  validation, Jest coverage and production dependency audit.

## Installation

```bash
npm install homie-home-assistant-discovery
```

## Standalone Daemon

Run the bridge against a local broker:

```bash
homie-home-assistant-discovery --broker mqtt://localhost:1883
```

By default it watches `homie/#` and publishes retained Home Assistant discovery
messages under `homeassistant/`.

A production-style launch usually looks like this:

```bash
homie-home-assistant-discovery \
  --broker mqtt://localhost:1883 \
  --homie-domain homie \
  --legacy-root homie \
  --discovery-prefix homeassistant \
  --id-prefix homie \
  --boolean-platform switch \
  --subscription-qos 1 \
  --log-level info \
  --overrides ./discovery-overrides.json
```

Secure brokers use MQTT.js connection options exposed by the CLI:

```bash
homie-home-assistant-discovery \
  --broker mqtts://broker.example.com:8883 \
  --mqtt-version 5 \
  --ca ./certs/ca.pem \
  --cert ./certs/client.pem \
  --key ./certs/client.key
```

Use `--no-attribute-diagnostics` if you only want entities declared by Homie
device metadata and do not want observed v5 `$...` attributes exposed as
diagnostic entities.

## Library Usage

```ts
import { HomieHaDiscoveryBridge } from "homie-home-assistant-discovery";

const bridge = new HomieHaDiscoveryBridge();

const result = bridge.ingest({
  topic: "homie/5/kitchen/$description",
  payload: JSON.stringify({
    homie: "5.0",
    version: 1,
    name: "Kitchen",
    nodes: {
      relay: {
        name: "Relay",
        properties: {
          state: { datatype: "boolean", settable: true },
        },
      },
    },
  }),
  retain: true,
});

for (const message of result.messages) {
  // Publish message.topic with retained message.payload to MQTT.
}
```

## What Gets Discovered

The automatic mapper uses Homie metadata first and falls back conservatively:

- settable `boolean` properties become `light` or `fan` when Homie `type` /
  `name` metadata says so, otherwise `switch`
- read-only `boolean` properties become `binary_sensor`
- settable `enum` properties become `select`
- settable `integer`, `float` and `string` properties become `number` or `text`
- read-only numeric and text properties become `sensor`
- Homie v5 lifecycle state can be exposed as a diagnostic sensor
- observed non-operational Homie v5 attributes can be exposed as diagnostic
  entities

The bridge does not guess complex Home Assistant domains such as `climate`,
`cover`, `lock`, `vacuum` or `alarm_control_panel` from generic Homie metadata
alone. Those domains need semantic intent, so they should be modeled with
overrides.

## Overrides

Overrides let advanced users keep devices generic while making Home Assistant
entities precise. Use `deviceDefaults` and templates for shared conventions,
then keep each device override to the metadata Homie cannot know.

```json
{
  "deviceDefaults": {
    "objectId": "acme_{deviceId}",
    "identifiers": ["ACME_{deviceId}"]
  },
  "namedNodeState": {
    "platform": "light",
    "objectId": "acme_{deviceId}_{nodeId}"
  },
  "devices": {
    "homie/5/kitchen": {
      "name": "Kitchen Board",
      "nodeNames": {
        "relay": "Ceiling",
        "fan": {
          "name": "Extractor Fan",
          "platform": "fan"
        }
      }
    }
  }
}
```

See
[Discovery overrides](https://github.com/labodj/homie-home-assistant-discovery/blob/main/docs/OVERRIDES.md)
for the complete schema and examples.

## Documentation

- [Usage](https://github.com/labodj/homie-home-assistant-discovery/blob/main/docs/USAGE.md)
- [Discovery overrides](https://github.com/labodj/homie-home-assistant-discovery/blob/main/docs/OVERRIDES.md)
- [Home Assistant discovery mapping](https://github.com/labodj/homie-home-assistant-discovery/blob/main/docs/HOME_ASSISTANT_DISCOVERY.md)
- [Homie compatibility](https://github.com/labodj/homie-home-assistant-discovery/blob/main/docs/HOMIE_COMPATIBILITY.md)

## Related Package

Prefer a visual Node-RED flow? Use
[`node-red-contrib-homie-home-assistant-discovery`](https://github.com/labodj/node-red-contrib-homie-home-assistant-discovery),
which wraps this core package with a Node-RED editor UI and MQTT node wiring.

## Local Quality Gate

```bash
npm ci
npm run check
```

`npm run check` typechecks, lints, formats, builds, validates packaged
documentation links, installs the local tarball in a temporary consumer project
and runs the Jest suite.

## License

Apache-2.0. See
[LICENSE](https://github.com/labodj/homie-home-assistant-discovery/blob/main/LICENSE).
