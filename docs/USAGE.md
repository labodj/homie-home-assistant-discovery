# Usage

`homie-home-assistant-discovery` has two jobs:

1. listen to Homie metadata on MQTT;
2. publish Home Assistant MQTT discovery messages.

It does not replace your broker, your Homie devices or Home Assistant. It only
bridges the metadata conventions so Home Assistant can see the entities that
Homie devices already describe.

You can use it in three ways:

- run the CLI as a standalone bridge;
- embed the TypeScript/JavaScript core in your own application;
- use the companion Node-RED node for visual MQTT wiring.

## Standalone CLI

The smallest useful command is:

```bash
homie-home-assistant-discovery --broker mqtt://localhost:1883
```

With the defaults, the bridge subscribes to Homie metadata under `homie/#` and
publishes retained discovery messages under `homeassistant/`.

If the configured legacy root does not also cover the v5 domain, the bridge adds
the v5 subscriptions it needs. When attribute diagnostics are enabled, that v5
subscription is intentionally broad enough to see extension-style `$...`
attributes. Disable attribute diagnostics if you want the narrowest possible
metadata subscriptions.

```bash
homie-home-assistant-discovery \
  --broker mqtt://broker.example.local:1883 \
  --homie-domain homie \
  --legacy-root homie \
  --discovery-prefix homeassistant \
  --id-prefix homie \
  --boolean-platform auto \
  --subscription-qos 1 \
  --log-level info
```

### Common Options

| Option                       | Default                 | Meaning                                             |
| ---------------------------- | ----------------------- | --------------------------------------------------- |
| `--broker`                   | `mqtt://localhost:1883` | MQTT broker URL.                                    |
| `--homie-domain`             | `homie`                 | Homie v5 topic domain.                              |
| `--legacy-root`              | `homie`                 | Homie v3/v4 topic root.                             |
| `--discovery-prefix`         | `homeassistant`         | Home Assistant discovery prefix.                    |
| `--id-prefix`                | `homie`                 | Prefix for generated discovery IDs and entity IDs.  |
| `--manufacturer`             | `Homie`                 | Default Home Assistant manufacturer.                |
| `--model`                    | `Homie MQTT Device`     | Default Home Assistant model.                       |
| `--boolean-platform`         | `auto`                  | Boolean fallback: `auto`, `switch`, `light`, `fan`. |
| `--subscription-qos`         | `1`                     | MQTT subscription QoS: `0`, `1`, `2`.               |
| `--mqtt-version`             | `4`                     | MQTT protocol version: `4` or `5`.                  |
| `--client-id`                | unset                   | MQTT client id.                                     |
| `--username`                 | unset                   | MQTT username.                                      |
| `--password`                 | unset                   | MQTT password.                                      |
| `--ca`                       | unset                   | TLS CA certificate file. Can be repeated.           |
| `--cert`                     | unset                   | TLS client certificate file for mutual TLS.         |
| `--key`                      | unset                   | TLS client private key file for mutual TLS.         |
| `--key-passphrase`           | unset                   | TLS client private key passphrase.                  |
| `--reject-unauthorized`      | `true`                  | Verify the broker TLS certificate.                  |
| `--overrides`                | unset                   | JSON override file.                                 |
| `--log-level`                | `info`                  | `silent`, `error`, `warn`, `info` or `debug`.       |
| `--disable-v3`               | false                   | Disable Homie v3.0.1 discovery.                     |
| `--disable-v4`               | false                   | Disable Homie v4.0.0 discovery.                     |
| `--disable-v5`               | false                   | Disable Homie v5 discovery.                         |
| `--no-state-sensor`          | false                   | Disable the diagnostic Homie State sensor.          |
| `--no-attribute-diagnostics` | false                   | Disable observed v5 `$...` diagnostic entities.     |

At least one Homie version must remain enabled.

### Environment Variables

Every common CLI setting can also come from the environment. This is useful for
containers and service managers where secrets should not live in shell history.

- `HOMIE_HA_MQTT_URL`
- `HOMIE_HA_HOMIE_DOMAIN`
- `HOMIE_HA_LEGACY_ROOT`
- `HOMIE_HA_DISCOVERY_PREFIX`
- `HOMIE_HA_ID_PREFIX`
- `HOMIE_HA_MANUFACTURER`
- `HOMIE_HA_MODEL`
- `HOMIE_HA_INCLUDE_STATE_SENSOR`
- `HOMIE_HA_INCLUDE_ATTRIBUTE_DIAGNOSTICS`
- `HOMIE_HA_BOOLEAN_PLATFORM`
- `HOMIE_HA_SUBSCRIPTION_QOS`
- `HOMIE_HA_MQTT_VERSION`
- `HOMIE_HA_CLIENT_ID`
- `HOMIE_HA_USERNAME`
- `HOMIE_HA_PASSWORD`
- `HOMIE_HA_MQTT_CA`
- `HOMIE_HA_MQTT_CERT`
- `HOMIE_HA_MQTT_KEY`
- `HOMIE_HA_MQTT_KEY_PASSPHRASE`
- `HOMIE_HA_MQTT_REJECT_UNAUTHORIZED`
- `HOMIE_HA_OVERRIDES`
- `HOMIE_HA_LOG_LEVEL`

Command-line flags win over environment variables when both are supplied.

`HOMIE_HA_MQTT_CA` accepts multiple CA files separated with the platform path
delimiter (`:` on Linux/macOS, `;` on Windows). The CLI `--ca` flag can also be
repeated.

## MQTT Credentials and TLS

For a username/password broker:

```bash
homie-home-assistant-discovery \
  --broker mqtt://broker.example.local:1883 \
  --username homie \
  --password homie
```

For TLS, use `mqtts://`. A private CA is often the right production setup:

```bash
homie-home-assistant-discovery \
  --broker mqtts://broker.example.local:8883 \
  --mqtt-version 5 \
  --ca ./certs/ca.pem \
  --username homie \
  --password homie
```

For mutual TLS, also provide the client certificate and key:

```bash
homie-home-assistant-discovery \
  --broker mqtts://broker.example.local:8883 \
  --ca ./certs/ca.pem \
  --cert ./certs/client.pem \
  --key ./certs/client.key \
  --key-passphrase "$CLIENT_KEY_PASSPHRASE"
```

`--reject-unauthorized false` exists for throwaway test brokers with self-signed
certificates. It disables broker certificate verification, so do not use it for
production.

## Entity Mapping Basics

The bridge first reads what Homie says, then chooses the safest Home Assistant
entity type.

- A read-only boolean is a `binary_sensor`.
- A commandable boolean is usually a `switch`.
- A commandable boolean can become a `light` or `fan` when Homie names/types
  clearly say so, or when you configure that with overrides.
- A commandable number is a `number`.
- A commandable enum with options is a `select`.
- A commandable string-like value is a `text`.
- Read-only values that do not fit the above become `sensor`.

The `--boolean-platform` setting is not an enable/disable toggle. It only
controls the fallback for commandable booleans when no rule or exact override
selects something more specific.

## A Commented Override Walkthrough

Comments are useful while learning the shape, but JSON files cannot contain
comments. Treat this `jsonc` block as documentation, then remove comments in
your actual override file.

```jsonc
{
  // Shared identity applied before device-specific settings.
  "deviceDefaults": {
    // Home Assistant device object id and discovery topic base.
    "objectId": "home_{deviceId}",

    // Stable Home Assistant device identifier.
    "identifiers": ["homie:{baseTopic}"],
  },

  // For devices listed below, map named node "state" properties to lights.
  "namedNodeState": {
    // Default platform for those node/state entities.
    "platform": "light",

    // Stable unique_id/default entity id base for each entity.
    "objectId": "home_{deviceId}_{nodeId}",
  },

  // Per-device names and exceptions.
  "devices": {
    // Full Homie v5 base topic for one device.
    "homie/5/kitchen-board": {
      // Name shown for the Home Assistant device.
      "name": "Kitchen board",

      // Compact map from Homie node id to Home Assistant entity name.
      "nodeNames": {
        // Simple case: ceiling/state becomes a light named "Ceiling light".
        "ceiling": "Ceiling light",

        // Exception: extractor/state should be a fan, not a light.
        "extractor": {
          "name": "Extractor fan",
          "platform": "fan",
        },
      },
    },
  },
}
```

Copyable JSON version:

```json
{
  "deviceDefaults": {
    "objectId": "home_{deviceId}",
    "identifiers": ["homie:{baseTopic}"]
  },
  "namedNodeState": {
    "platform": "light",
    "objectId": "home_{deviceId}_{nodeId}"
  },
  "devices": {
    "homie/5/kitchen-board": {
      "name": "Kitchen board",
      "nodeNames": {
        "ceiling": "Ceiling light",
        "extractor": {
          "name": "Extractor fan",
          "platform": "fan"
        }
      }
    }
  }
}
```

For the full schema, read [Discovery overrides](OVERRIDES.md).

## Library API

Use the core class when another application already owns the MQTT connection.

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
  // Publish message.topic with retained message.payload to MQTT.
}
```

`ingest()` returns:

| Field      | Meaning                                                       |
| ---------- | ------------------------------------------------------------- |
| `messages` | MQTT discovery messages to publish.                           |
| `warnings` | Input problems that did not throw.                            |
| `logs`     | Informational events such as discovery generation or cleanup. |

The bridge is stateful. It remembers what it already published so it can emit
cleanup messages when Homie metadata changes or disappears.

### Reset

```ts
const cleanupMessages = bridge.reset();
```

`reset()` clears in-memory state and returns retained cleanup messages for
devices that were previously published.

## Programmatic MQTT Adapter

Use the MQTT adapter when your application should let this package manage the
MQTT connection, but the CLI is not the right fit.

```ts
import { HomieHaDiscoveryMqttBridge } from "homie-home-assistant-discovery/mqtt";

const bridge = new HomieHaDiscoveryMqttBridge({
  brokerUrl: "mqtt://localhost:1883",
});

await bridge.start();
```

The adapter exposes:

- `start()`
- `stop()`
- `flush()`

`flush()` is mainly useful in tests after publishing broker messages.

The adapter processes MQTT messages sequentially. If publishing one discovery
message fails, the error is sent to the configured logger and later MQTT
messages can still be processed.

## Subscription Builder

Advanced integrations can use the same subscription builder as the MQTT adapter.

```ts
import { buildHomieMqttSubscriptions } from "homie-home-assistant-discovery/mqtt";

const subscriptions = buildHomieMqttSubscriptions({
  homieDomain: "building/homie",
  legacyRoot: "homie",
  enabledVersions: [4, 5],
  includeAttributeDiagnostics: true,
  qos: 1,
});
```

## Runtime Package Version

Generated Home Assistant discovery payloads include `origin.sw_version` from
the package version when the default origin is used. The value is generated into
`src/version.ts` by:

```bash
npm run sync:version
```

## Local Package Verification

```bash
npm run build
npm run verify:package
```

The verification script creates a local tarball, installs it into a temporary
consumer project, checks the root export, checks the
`homie-home-assistant-discovery/mqtt` subpath and runs the CLI help entrypoint.
It never publishes to npm.
