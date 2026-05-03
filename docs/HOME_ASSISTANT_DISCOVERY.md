# Home Assistant Discovery Mapping

This document explains what the bridge publishes to Home Assistant and why.

The short version: every supported Homie property becomes a stable Home
Assistant MQTT entity when the bridge has enough metadata to describe it safely.
When Homie metadata is too generic, the bridge chooses a conservative fallback
and lets overrides carry the human meaning.

## The Mapping Contract

The mapper follows two rules:

- use Homie metadata to generate deterministic Home Assistant MQTT discovery;
- avoid inventing specialized Home Assistant domains when Homie core does not
  express the required semantics.

For example, a Homie `boolean` with `settable=true` might be a light, a fan, a
relay, a plug, a lock bit or an internal flag. The bridge can infer common
lights and fans from names/types, but generic booleans fall back to `switch`.
That is less automatic than publishing a more specific domain immediately, but
it avoids retained discovery that encodes the wrong meaning.

Home Assistant discovery payloads use the device discovery model: one retained
device config payload contains the Home Assistant device object, origin metadata
and a `components` object. Each component has a platform, a stable `unique_id`,
a `default_entity_id` and the MQTT state/command topics Home Assistant should
use.

## Automatic vs. Override Responsibility

Automatic mapping handles facts Homie already provides:

- stable device and component IDs;
- state topics and command topics;
- availability from `$state`;
- datatype-to-platform fallback;
- numeric, enum and boolean formats;
- Homie units;
- retained/non-retained hints that affect Home Assistant updates;
- conservative sensor metadata such as common device classes;
- lifecycle and observed v5 attribute diagnostics when enabled.

Overrides handle the meaning only you or the device stack can know:

- whether a generic commandable boolean is a light, fan or switch;
- friendly entity names, icons and object IDs;
- Home Assistant device classes and state classes beyond conservative inference;
- custom payloads, command topics, value templates and options;
- entities that should be hidden or disabled;
- existing Home Assistant IDs that must be preserved during migration.

The bridge intentionally does not invent `climate`, `cover`, `lock`, `vacuum`,
`button`, `scene`, `siren`, `valve`, `water_heater` or alarm entities from
plain Homie datatype metadata. Those domains need their own semantics and Home
Assistant configuration fields.

## Discovery Topics

The main device discovery payload is published to:

```text
<discoveryPrefix>/device/<deviceObjectId>/config
```

The optional diagnostic Homie State sensor is published to:

```text
<discoveryPrefix>/sensor/<deviceObjectId>_homie_state/config
```

All discovery messages are retained with QoS `1`.

## Device Object IDs

By default, the device object ID is built from the configured `idPrefix` and the
Homie base topic:

```text
<idPrefix>_<homie namespace>_<device ID>
```

Examples:

| Homie base topic                 | Object ID                              |
| -------------------------------- | -------------------------------------- |
| `homie/5/kitchen-board`          | `homie_homie_5_kitchen_board`          |
| `building/homie/5/kitchen-board` | `homie_building_homie_5_kitchen_board` |
| `homie/weather-station`          | `homie_homie_weather_station`          |

Object ID segments are normalized to lowercase alphanumeric underscores.

Use a device override when you need a cleaner or historical object ID:

```json
{
  "devices": {
    "homie/5/kitchen-board": {
      "objectId": "home_kitchen_board"
    }
  }
}
```

That makes the main config topic:

```text
homeassistant/device/home_kitchen_board/config
```

## Device Payload

The main retained payload contains:

- `device`
- `origin`
- `availability_topic`
- `availability_template`
- `payload_available`
- `payload_not_available`
- `qos`
- `components`

`origin.sw_version` is set from the package version when the default origin is
used.

Legacy firmware metadata can enrich the Home Assistant device:

| Homie metadata | Home Assistant device field                                 |
| -------------- | ----------------------------------------------------------- |
| `$fw/name`     | `model` when no Homie `type` or override model is available |
| `$fw/version`  | `sw_version`                                                |
| `$mac`         | `connections: [["mac", value]]`                             |

Homie v5 device relationships are mapped to Home Assistant `via_device`. When
both `root` and `parent` exist, `parent` wins because it represents the direct
upstream device. When only `root` exists, `root` is used.

## Availability

Availability comes from:

```text
<homie base topic>/$state
```

`ready` means online. Any other value means offline.

## Component IDs

Component IDs default to:

```text
<deviceObjectId>_<nodeId>_<propertyId>
```

Overrides can replace the entity object ID with `objectId`, or the full first
Home Assistant entity ID with `defaultEntityId`.

## Platform Mapping

This table is the automatic fallback before `namedNodeState`, `rules` and exact
overrides are applied.

| Homie property state                   | Home Assistant platform                                                | Command topic |
| -------------------------------------- | ---------------------------------------------------------------------- | ------------- |
| non-settable `boolean`                 | `binary_sensor`                                                        | no            |
| settable `boolean`                     | `auto` semantic mapping, or configured `switch`/`light`/`fan` fallback | yes           |
| settable `integer`                     | `number`                                                               | yes           |
| settable `float`                       | `number`                                                               | yes           |
| settable `enum` with parsed options    | `select`                                                               | yes           |
| settable `enum` without parsed options | `text`                                                                 | yes           |
| settable `string`                      | `text`                                                                 | yes           |
| settable `color`                       | `text`                                                                 | yes           |
| settable `datetime`                    | `text`                                                                 | yes           |
| settable `duration`                    | `text`                                                                 | yes           |
| settable `json`                        | `text`                                                                 | yes           |
| non-settable `integer`                 | `sensor`                                                               | no            |
| non-settable `float`                   | `sensor`                                                               | no            |
| non-settable `string`                  | `sensor`                                                               | no            |
| non-settable `enum`                    | `sensor`                                                               | no            |
| non-settable `color`                   | `sensor`                                                               | no            |
| non-settable `datetime`                | `sensor` with `device_class: "timestamp"`                              | no            |
| non-settable `duration`                | `sensor` with `device_class: "duration"`                               | no            |
| non-settable `json`                    | `sensor` with JSON attributes                                          | no            |

The command topic is the Homie property state topic with `/set` appended, unless
a property override supplies `commandTopic`.

Homie v3/v4 core datatypes are `integer`, `float`, `boolean`, `string`, `enum`
and `color`. Homie v5 adds `datetime`, `duration` and `json`. Homie v3 devices
may omit `$datatype`; the bridge follows the v3 convention and treats that
property as `string`. Homie v4 and v5 require a datatype before discovery can be
generated.

## Boolean Mapping

`defaultCommandableBooleanPlatform` controls only commandable Homie booleans
that have no more specific rule or override.

| Option   | Use when                                                 |
| -------- | -------------------------------------------------------- |
| `auto`   | Infer common lights/fans from Homie metadata.            |
| `switch` | The device exposes relays, plugs or generic outputs.     |
| `light`  | Most commandable booleans in the mapped root are lights. |
| `fan`    | Most commandable booleans in the mapped root are fans.   |

`auto` looks at Homie node/property `type`, `name` and ids. It recognizes common
words such as `light`, `lights`, `lamp`, `led`, `fan` and `fans`. Unknown or
generic booleans remain `switch`.

Non-settable booleans are always `binary_sensor` because Home Assistant cannot
command them.

For a simple installation where named `state` properties are mostly lights, use
`namedNodeState`:

```json
{
  "namedNodeState": {
    "platform": "light"
  },
  "devices": {
    "homie/5/kitchen-board": {
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

For broader patterns, use ordered rules:

```json
{
  "rules": [
    {
      "match": {
        "path": "lights/*",
        "datatype": "boolean",
        "settable": true
      },
      "platform": "light"
    }
  ],
  "devices": {
    "homie/5/garden-board": {
      "properties": {
        "pump/state": {
          "platform": "switch",
          "name": "Fountain pump",
          "icon": "mdi:water-pump"
        }
      }
    }
  }
}
```

Mapping priority is:

1. built-in datatype mapping and boolean semantic mapping;
2. `namedNodeState` for named commandable boolean `state` properties;
3. ordered mapping rules;
4. exact device, node and property overrides.

## Automatic Coverage Boundaries

The package automatically emits these Home Assistant MQTT platforms:

- `sensor`
- `binary_sensor`
- `switch`
- `light`
- `fan`
- `number`
- `select`
- `text`

[Home Assistant MQTT discovery](https://www.home-assistant.io/integrations/mqtt/#mqtt-discovery)
supports more component domains, but many of them require semantics that Homie
core does not standardize. The project chooses a conservative `switch` with an
explicit override path over an inferred `lock` or `cover` that could be wrong.

## Number Format

Homie numeric format uses:

```text
min:max:step
```

Examples:

| Homie format | Number config                   |
| ------------ | ------------------------------- |
| `0:100:5`    | `min: 0`, `max: 100`, `step: 5` |
| `0:`         | `min: 0`                        |
| `:100`       | `max: 100`                      |

Invalid or missing numeric format fields are ignored.

## Boolean Format

Homie boolean format may define payloads:

```text
off,on
```

This maps to:

- `payload_off: "off"`
- `payload_on: "on"`

Without a format, default payloads are `"false"` and `"true"`.

## Enum Format

Homie enum format uses comma-separated options. Escaped commas are represented
as doubled commas.

```text
auto,manual,off
```

Settable enum properties become `select` entities when options are available.
If no options are available, the property becomes a `text` entity instead of an
empty select.

## Sensor Metadata

The mapper preserves Homie units as `unit_of_measurement` for sensors and
numbers.

It also infers common `device_class` values when the signal is unambiguous:

| Unit / semantic hint                     | Device class      |
| ---------------------------------------- | ----------------- |
| `°C`, `°F`, `K`                          | `temperature`     |
| `%` with humidity naming                 | `humidity`        |
| `%` with battery naming                  | `battery`         |
| `V`, `mV`                                | `voltage`         |
| `A`, `mA`                                | `current`         |
| `W`, `kW`                                | `power`           |
| `Wh`, `kWh`, `MWh`                       | `energy`          |
| `Pa`, `hPa`, `kPa`, `mbar`, `bar`, `psi` | `pressure`        |
| `Hz`, `kHz`, `MHz`, `GHz`                | `frequency`       |
| `lx`, `lux`                              | `illuminance`     |
| `dBm`                                    | `signal_strength` |

Numeric sensors default to `state_class: "measurement"` unless an override
provides a specific state class.

## JSON Datatype

Non-settable Homie JSON properties become sensors with:

- `value_template: "{{ 'json' }}"`
- `json_attributes_topic` set to the property state topic

Settable JSON properties become `text` entities so Home Assistant can publish
raw JSON strings to the Homie `/set` topic.

## V5 Attribute Diagnostics

When attribute diagnostics are enabled, observed Homie v5 attribute topics are
exposed as diagnostic entities without hard-coding any extension family.

Examples:

- `$fw/version` can enrich device firmware metadata;
- `$stats/uptime` can become a duration diagnostic sensor;
- `$implementation/ota/enabled` can become a diagnostic binary sensor;
- unknown `$vendor/...` attributes can still become plain diagnostic sensors.

Core operational attributes are not exposed as diagnostics:

- `$state` drives availability;
- `$description` drives discovery;
- `$log` is a non-retained logging stream;
- `$alert` is user-facing alert behavior;
- bare `$stats` is only an index for concrete `$stats/*` values.

The mapper derives conservative payload metadata:

| Observed payload          | Platform        | Notes                              |
| ------------------------- | --------------- | ---------------------------------- |
| `true` or `false`         | `binary_sensor` | `payload_on` and `payload_off` set |
| integer or float payloads | `sensor`        | `state_class: "measurement"`       |
| JSON object or array      | `sensor`        | JSON exposed as attributes         |
| other payloads            | `sensor`        | string state                       |

Override matching uses the attribute path under a synthetic `diagnostics` node.
For example, `$implementation/ota/enabled` becomes
`diagnostics/implementation-ota-enabled` for exact property overrides.

The v5 `$description` payload also contributes derived diagnostic entities for
the Homie convention version, description version and declared extension list.

Homie extension names do not provide a complete machine-readable schema by
themselves. Use overrides to set exact units, icons, device classes, state
classes, names or object IDs, or to disable noisy diagnostics.

## Legacy Stats

Known Homie legacy `$stats/*` topics become diagnostic sensors:

| Homie stats topic | Platform | Unit | Device class  |
| ----------------- | -------- | ---- | ------------- |
| `$stats/interval` | `sensor` | `s`  | none          |
| `$stats/uptime`   | `sensor` | `s`  | `duration`    |
| `$stats/signal`   | `sensor` | `%`  | none          |
| `$stats/cputemp`  | `sensor` | `°C` | `temperature` |
| `$stats/cpuload`  | `sensor` | `%`  | none          |
| `$stats/battery`  | `sensor` | `%`  | `battery`     |
| `$stats/freeheap` | `sensor` | `B`  | none          |
| `$stats/supply`   | `sensor` | `V`  | `voltage`     |

All stats entities use `entity_category: "diagnostic"`.

## Cleanup

Cleanup messages are retained empty payloads. They are emitted when:

- a published device `$state` retained topic is deleted;
- a Homie v5 `$description` retained topic is deleted;
- a v5 description no longer contains valid properties;
- legacy v3/v4 `$nodes` or `$properties` retained metadata removes all valid
  entities;
- a required legacy datatype is deleted or becomes unsupported;
- `reset()` is called on the bridge.

When only some components disappear, the mapper emits a new device discovery
payload without those components. This lets Home Assistant remove stale entities
without deleting the whole device.

## Non-Mapped Homie Topics

The bridge consumes metadata and generates discovery. It does not process normal
property state payloads, validate live property values or implement application
behavior for broadcasts and alerts.

Home Assistant entities subscribe directly to the generated Homie `state_topic`
and publish directly to the generated Homie `command_topic`.

Homie v5 `$target` is device feedback for command acceptance and in-flight
transitions. It is not needed to create Home Assistant discovery, so the bridge
leaves it to the device/runtime path. If a stable Home Assistant convention
appears later, target state can be considered as optional metadata.
