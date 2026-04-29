# Usage

`homie-home-assistant-discovery` can run in three ways:

1. as a standalone MQTT daemon,
2. as a TypeScript/JavaScript library,
3. through the companion Node-RED package.

The standalone core never starts Home Assistant and never owns Homie devices. It
listens to Homie metadata and publishes Home Assistant MQTT discovery messages.

## Standalone Daemon

```bash
homie-home-assistant-discovery --broker mqtt://localhost:1883
```

With the default `homie` roots this subscribes to `homie/#`. When the
configured legacy root does not cover the v5 domain, the daemon adds a separate
`homie/5/+/#` subscription.

and publishes retained Home Assistant MQTT discovery messages under
`homeassistant/`.

The broad v5 subscription is used so the bridge can observe standard and
extension `$...` attributes and expose only the attributes that actually exist
as diagnostic entities. Use `--no-attribute-diagnostics` if you want the daemon
to subscribe only to v5 `$description` and `$state`.

### Common Options

```bash
homie-home-assistant-discovery \
  --broker mqtt://localhost:1883 \
  --homie-domain homie \
  --legacy-root homie \
  --discovery-prefix homeassistant \
  --id-prefix homie
```

| Option                       | Default                 | Meaning                                            |
| ---------------------------- | ----------------------- | -------------------------------------------------- |
| `--broker`                   | `mqtt://localhost:1883` | MQTT broker URL.                                   |
| `--homie-domain`             | `homie`                 | Homie v5 topic domain.                             |
| `--legacy-root`              | `homie`                 | Homie v3/v4 topic root.                            |
| `--discovery-prefix`         | `homeassistant`         | Home Assistant discovery prefix.                   |
| `--id-prefix`                | `homie`                 | Prefix for generated discovery IDs and entity IDs. |
| `--manufacturer`             | `Homie`                 | Default Home Assistant manufacturer.               |
| `--model`                    | `Homie MQTT Device`     | Default Home Assistant model.                      |
| `--boolean-platform`         | `auto`                  | Boolean mapping: `auto`, `switch`, `light`, `fan`. |
| `--subscription-qos`         | `1`                     | MQTT subscription QoS: `0`, `1`, `2`.              |
| `--mqtt-version`             | `4`                     | MQTT protocol version: `4` or `5`.                 |
| `--client-id`                | unset                   | MQTT client id.                                    |
| `--username`                 | unset                   | MQTT username.                                     |
| `--password`                 | unset                   | MQTT password.                                     |
| `--ca`                       | unset                   | TLS CA certificate file. Can be repeated.          |
| `--cert`                     | unset                   | TLS client certificate file for mutual TLS.        |
| `--key`                      | unset                   | TLS client private key file for mutual TLS.        |
| `--key-passphrase`           | unset                   | TLS client private key passphrase.                 |
| `--reject-unauthorized`      | `true`                  | Verify the broker TLS certificate.                 |
| `--overrides`                | unset                   | JSON override file.                                |
| `--log-level`                | `info`                  | `silent`, `error`, `warn`, `info` or `debug`.      |
| `--disable-v3`               | false                   | Disable Homie v3.0.1 discovery.                    |
| `--disable-v4`               | false                   | Disable Homie v4.0.0 discovery.                    |
| `--disable-v5`               | false                   | Disable Homie v5 discovery.                        |
| `--no-state-sensor`          | false                   | Disable the diagnostic Homie State sensor.         |
| `--no-attribute-diagnostics` | false                   | Disable observed v5 `$...` diagnostic entities.    |

At least one Homie version must remain enabled.

### Environment Variables

The CLI also reads:

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

Command-line flags override environment defaults when both are supplied.

`HOMIE_HA_MQTT_CA` accepts multiple CA files separated with the platform path
delimiter (`:` on Linux/macOS, `;` on Windows). The CLI `--ca` flag can be
repeated.

### Secure MQTT

MQTT credentials are passed directly to MQTT.js:

```bash
homie-home-assistant-discovery \
  --broker mqtt://broker.example.com:1883 \
  --username homie \
  --password homie
```

Use `mqtts://` for TLS. A private CA certificate is usually preferable to
disabling certificate verification:

```bash
homie-home-assistant-discovery \
  --broker mqtts://broker.example.com:8883 \
  --mqtt-version 5 \
  --ca ./certs/ca.pem \
  --username homie \
  --password homie
```

For mutual TLS, provide both the client certificate and private key:

```bash
homie-home-assistant-discovery \
  --broker mqtts://broker.example.com:8883 \
  --ca ./certs/ca.pem \
  --cert ./certs/client.pem \
  --key ./certs/client.key \
  --key-passphrase "$CLIENT_KEY_PASSPHRASE"
```

`--reject-unauthorized false` is available for test brokers with self-signed
certificates, but it disables broker certificate verification and should not be
used for production.

## Entity Mapping

Every supported Homie datatype is mapped to a safe Home Assistant MQTT entity.
The default mapping uses Homie metadata first and falls back conservatively:

- non-settable booleans become `binary_sensor`;
- settable booleans become `light` or `fan` when Homie `type` / `name`
  metadata says so, otherwise `switch`;
- settable numbers become `number`;
- settable enums with options become `select`;
- other settable properties become `text`;
- other non-settable properties become `sensor`.

The boolean platform setting is not an on/off switch. `auto` maps common Homie
`light` and `fan` names/types to matching Home Assistant platforms and uses
`switch` when the metadata is generic. `switch`, `light` and `fan` force that
fallback globally.

Use compact JSON overrides when a device or fleet follows a simple convention.
This example maps the `state` property of named nodes to lights, while one node
is an explicit fan:

```json
{
  "namedNodeState": {
    "platform": "light",
    "objectId": "acme_{deviceId}_{nodeId}"
  },
  "devices": {
    "homie/5/kitchen": {
      "nodeNames": {
        "ceiling": "Kitchen Ceiling",
        "extractor": {
          "name": "Extractor Fan",
          "platform": "fan"
        }
      }
    }
  }
}
```

Use ordered rules and exact property overrides for advanced mapping. Exact
device/node/property overrides always win over generic shortcuts and rules.

For the full matrix and coverage boundaries, see
[Home Assistant discovery mapping](HOME_ASSISTANT_DISCOVERY.md).

## Library API

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

`ingest()` returns:

| Field      | Meaning                                                       |
| ---------- | ------------------------------------------------------------- |
| `messages` | MQTT discovery messages to publish.                           |
| `warnings` | Input problems that did not throw.                            |
| `logs`     | Informational events such as discovery generation or cleanup. |

The bridge is stateful. It remembers previously published components so it can
emit removal transitions and cleanup messages when Homie metadata changes.

### Reset

```ts
const cleanupMessages = bridge.reset();
```

`reset()` clears in-memory state and returns retained cleanup messages for
devices that were previously published.

## Programmatic MQTT Adapter

```ts
import { HomieHaDiscoveryMqttBridge } from "homie-home-assistant-discovery/mqtt";

const bridge = new HomieHaDiscoveryMqttBridge({
  brokerUrl: "mqtt://localhost:1883",
});

await bridge.start();
```

The adapter uses MQTT.js and exposes:

- `start()`
- `stop()`
- `flush()`

`flush()` is useful in tests after emitting broker messages.

The adapter processes MQTT messages sequentially. If publishing one discovery
message fails, the error is sent to the configured logger and later MQTT
messages can still be processed.

## Subscription Builder

The MQTT adapter internally uses `buildHomieMqttSubscriptions()`. Advanced
integrations may use the same function to wire their own MQTT client.

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
consumer project, checks the root export, checks the `homie-home-assistant-discovery/mqtt`
subpath and runs the CLI help entrypoint. It never publishes to npm.
