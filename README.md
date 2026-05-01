# Homie Home Assistant Discovery

[![npm](https://img.shields.io/npm/v/homie-home-assistant-discovery.svg)](https://www.npmjs.com/package/homie-home-assistant-discovery)
[![npm downloads](https://img.shields.io/npm/dm/homie-home-assistant-discovery.svg)](https://www.npmjs.com/package/homie-home-assistant-discovery)
[![CI](https://github.com/labodj/homie-home-assistant-discovery/actions/workflows/ci.yaml/badge.svg?branch=main)](https://github.com/labodj/homie-home-assistant-discovery/actions/workflows/ci.yaml)
[![Node.js](https://img.shields.io/node/v/homie-home-assistant-discovery.svg)](https://www.npmjs.com/package/homie-home-assistant-discovery)
[![License](https://img.shields.io/github/license/labodj/homie-home-assistant-discovery.svg)](https://github.com/labodj/homie-home-assistant-discovery/blob/main/LICENSE)

[![works with MQTT Homie](https://homieiot.github.io/img/works-with-homie.svg "works with MQTT Homie")](https://homieiot.github.io/)

Use this package to turn Homie MQTT devices into Home Assistant MQTT discovery
entities.

Homie already describes devices, nodes and properties on MQTT. Home Assistant
already knows how to discover MQTT entities. This package sits between the two:
it listens to Homie metadata, builds stable Home Assistant discovery payloads
and publishes them as retained MQTT configuration messages.

You can run it as a small standalone service, embed it in your own
JavaScript/TypeScript application, or use the companion Node-RED node if you
prefer wiring everything visually.

## Pick Your Path

If you want to try it quickly, run the CLI against your broker:

```bash
npx homie-home-assistant-discovery --broker mqtt://localhost:1883
```

If you want to keep it running as a service, install it and pass the same
options from your service manager, container or process supervisor:

```bash
npm install -g homie-home-assistant-discovery

homie-home-assistant-discovery \
  --broker mqtt://192.168.1.10:1883 \
  --username homie \
  --password homie
```

If you want the mapper inside your own code, use `HomieHaDiscoveryBridge`.
It accepts MQTT-like messages and returns MQTT messages ready to publish.

```ts
import { HomieHaDiscoveryBridge } from "homie-home-assistant-discovery";

const bridge = new HomieHaDiscoveryBridge();

const result = bridge.ingest({
  topic: "homie/5/kitchen-board/$description",
  payload: JSON.stringify({
    homie: "5.0",
    version: 1,
    name: "Kitchen board",
    nodes: {
      ceiling: {
        name: "Ceiling light",
        properties: {
          state: { datatype: "boolean", settable: true },
        },
      },
    },
  }),
  retain: true,
});

for (const message of result.messages) {
  // Publish message.topic and message.payload to MQTT with message.retain=true.
}
```

## What It Does Automatically

The default mapping is designed to be useful without configuration:

- Homie v3.0.1 and v4.0.0 retained topic metadata is collected safely, even when
  the broker replays topics out of order.
- Homie v5.x `$description` documents are parsed directly.
- Stable Home Assistant `unique_id`, `default_entity_id`, availability and MQTT
  topics are generated.
- Read-only booleans become `binary_sensor`.
- Commandable booleans become `switch`, unless Homie names/types clearly look
  like a light or a fan, or you override them.
- Numbers, enums, strings, colors, datetimes, durations and JSON properties map
  to the safest Home Assistant MQTT platform available.
- Homie lifecycle and observed v5 `$...` attributes can become diagnostic
  entities.

The mapper is conservative by design. It will not invent a `cover`, `climate`,
`lock`, `alarm_control_panel` or similar domain from a generic Homie datatype,
because Homie core does not provide enough semantics to do that reliably. When
you know what a property really means, use overrides.

## A Small Override Example

Overrides are optional. Start without them, then add only the things Home
Assistant cannot infer from Homie metadata.

The example below does three things: named `state` properties become lights, the
extractor stays a fan, and Home Assistant gets readable IDs.

```jsonc
{
  // Shared Home Assistant identity for every discovered device.
  "deviceDefaults": {
    // Builds device discovery topics such as homeassistant/device/home_kitchen-board/config.
    "objectId": "home_{deviceId}",

    // Keeps Home Assistant device identifiers stable across restarts.
    "identifiers": ["homie:{baseTopic}"],

    // Optional fallback metadata when Homie does not provide a richer model.
    "manufacturer": "Homie",
    "model": "MQTT device",
  },

  // Shortcut for the common pattern: node/state is the useful entity.
  "namedNodeState": {
    // Every named commandable boolean state becomes a light by default.
    "platform": "light",

    // Entity IDs become light.home_kitchen-board_ceiling, etc.
    "objectId": "home_{deviceId}_{nodeId}",
  },

  // Device-specific naming and exceptions.
  "devices": {
    "homie/5/kitchen-board": {
      // Friendly Home Assistant device name.
      "name": "Kitchen board",

      // Only nodes listed here get the namedNodeState shortcut.
      "nodeNames": {
        // Simple string: name this state entity "Ceiling light".
        "ceiling": "Ceiling light",

        // Object form: same shortcut, but with one local exception.
        "extractor": {
          "name": "Extractor fan",
          "platform": "fan",
          "icon": "mdi:fan",
        },
      },
    },
  },
}
```

The override file you load must be valid JSON, so remove the comments before
putting it in `--overrides` or in the Node-RED editor. The full override guide
includes copyable JSON snippets:
[Discovery overrides](https://github.com/labodj/homie-home-assistant-discovery/blob/main/docs/OVERRIDES.md).

## CLI Essentials

Default behavior:

```bash
homie-home-assistant-discovery --broker mqtt://localhost:1883
```

This subscribes to Homie metadata under `homie/#` and publishes discovery under
`homeassistant/`.

Common production options:

```bash
homie-home-assistant-discovery \
  --broker mqtt://broker.example.local:1883 \
  --homie-domain homie \
  --legacy-root homie \
  --discovery-prefix homeassistant \
  --id-prefix homie \
  --boolean-platform auto \
  --subscription-qos 1 \
  --overrides ./discovery-overrides.json
```

Secure brokers are supported through MQTT.js options exposed by the CLI:

```bash
homie-home-assistant-discovery \
  --broker mqtts://broker.example.local:8883 \
  --mqtt-version 5 \
  --ca ./certs/ca.pem \
  --cert ./certs/client.pem \
  --key ./certs/client.key
```

Use `--no-attribute-diagnostics` when you only want entities declared by Homie
device metadata and do not want observed v5 `$...` attributes exposed as
diagnostic entities.

## Documentation

The full documentation map lives in
[DOCS.md](https://github.com/labodj/homie-home-assistant-discovery/blob/main/DOCS.md).
Start there for CLI usage, library embedding, discovery mapping, overrides and
Homie compatibility.

## Node-RED

Prefer a visual flow? Use
[`node-red-contrib-homie-home-assistant-discovery`](https://github.com/labodj/node-red-contrib-homie-home-assistant-discovery).
It wraps this package with a Node-RED editor UI, status handling, diagnostics
and normal MQTT node wiring.

## Local Quality Gate

```bash
npm ci
npm run check
```

`npm run check` typechecks, lints, formats, builds, validates packaged
documentation links, installs the local tarball in a temporary consumer project
and runs the Jest suite with coverage.

## License

Apache-2.0. See
[LICENSE](https://github.com/labodj/homie-home-assistant-discovery/blob/main/LICENSE).
