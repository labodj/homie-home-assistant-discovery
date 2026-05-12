# Homie Compatibility

This project behaves like a Homie controller for discovery purposes: it reads
Homie MQTT metadata and turns it into Home Assistant MQTT discovery payloads.

The bridge is strict about the discovery payloads it publishes, but tolerant
about the order in which MQTT metadata arrives. Invalid metadata should not
create invalid retained Home Assistant discovery, because a real broker may
replay retained topics in any order, hold stale metadata or contain devices from
more than one Homie generation.

## Supported Standards

| Homie version        | Support target                   | Discovery model                    |
| -------------------- | -------------------------------- | ---------------------------------- |
| 3.0.1                | Stable legacy support            | Retained topic metadata collector  |
| 4.0.0                | Stable legacy support            | Retained topic metadata collector  |
| 5.x                  | Stable current support           | `$description` JSON document       |
| Compatible 5.x minor | Tolerant support                 | Accept compatible 5.x descriptions |
| Future major         | Explicit implementation required | Add a version-specific parser      |

## Compatibility Promise

The package is a Home Assistant discovery bridge, not a full device automation
controller. It consumes the parts of Homie that describe devices, entities,
availability and command topics. It does not validate live property payload
values, and it does not implement application behavior for broadcasts, alerts or
extension-defined workflows.

The package is designed so that:

- conforming Homie v3.0.1, v4.0.0 and v5.x metadata becomes deterministic Home
  Assistant MQTT discovery when the semantics are safe to infer;
- incomplete or invalid metadata is ignored, warned about or cleaned up instead
  of becoming invalid retained discovery;
- specialized Home Assistant domains require explicit overrides unless Homie
  metadata carries enough meaning to map them safely.

## Future-Version Stance

Homie versions are handled with explicit boundaries. A compatible Homie 5.x
description is accepted as v5, while a future major version needs its own parser
and compatibility matrix before it can generate retained Home Assistant
discovery.

Practical consequence for this project:

- Do not assume a public v6 contract until the upstream convention publishes one.
- Keep v5 parsing tolerant to unknown fields and extension metadata.
- Keep major-version dispatch explicit, so a future v6 parser can be added
  without destabilizing v3/v4/v5.

References:

- Homie v3.0.1 specification: <https://homieiot.github.io/specification/spec-core-v3_0_1/>
- Homie v4.0.0 specification: <https://homieiot.github.io/specification/spec-core-v4_0_0/>
- Homie v5.0.0 specification: <https://homieiot.github.io/specification/spec-core-v5_0_0/>
- Homie Convention develop branch: <https://github.com/homieiot/convention/blob/develop/convention.md>
- Homie v5-to-develop diff: <https://homieiot.github.io/specification/spec-core-develop-diff/>
- Homie Convention project: <https://github.com/homieiot/convention>

## Spec-to-Implementation Matrix

The table below is intentionally explicit. It documents what the bridge
understands from each Homie generation.

| Homie capability                 | v3.0.1 support                                           | v4.0.0 support                                           | v5.x support                                                   | Test coverage                |
| -------------------------------- | -------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------- |
| Device discovery root            | Configurable legacy root, default `homie`                | Configurable legacy root, default `homie`                | Configurable domain, fixed major segment `5`                   | bridge, MQTT, soak           |
| Device ID validation             | Strict Homie ID format                                   | Strict Homie ID format                                   | Strict Homie ID format                                         | unit, fuzz                   |
| Device name                      | `$name`                                                  | `$name`                                                  | `description.name`                                             | golden, matrix               |
| Device type/model                | `$fw/name` fallback                                      | `$fw/name` fallback                                      | `description.type`                                             | golden                       |
| Firmware version                 | `$fw/version` to `sw_version`                            | `$fw/version` to `sw_version`                            | not a core v5 field                                            | golden                       |
| MAC connection                   | `$mac` to Home Assistant connection                      | `$mac` to Home Assistant connection                      | not a core v5 field                                            | golden                       |
| Device lifecycle availability    | `$state`                                                 | `$state`                                                 | `$state`                                                       | golden, MQTT, soak           |
| Device retained deletion         | empty `$state` or invalidated topology cleanup           | empty `$state` or invalidated topology cleanup           | empty `$state`/`$description` cleanup                          | golden, negative, MQTT, soak |
| Node discovery                   | `$nodes` and per-node `$properties`                      | `$nodes` and per-node `$properties`                      | `description.nodes`                                            | golden, matrix, soak         |
| Node arrays                      | `$nodes` entries with `[]` and `$array` ranges           | tolerated if present, not part of v4 core spec           | not part of v5 core spec                                       | golden, soak, negative       |
| Per-array element names          | `<node>_<index>/$name`                                   | tolerated if present                                     | not applicable                                                 | golden                       |
| Node type                        | `$type` consumed for rule matching                       | `$type` consumed for rule matching                       | `node.type` consumed for rule matching                         | overrides                    |
| Property discovery               | `$properties` plus property attributes                   | `$properties` plus property attributes                   | `description.nodes.*.properties`                               | golden, matrix               |
| Implicit string datatype         | Supported when `$datatype` is absent                     | not supported; `$datatype` is required                   | not supported; `datatype` is required                          | matrix, negative             |
| `integer` datatype               | sensor/number                                            | sensor/number                                            | sensor/number                                                  | matrix                       |
| `float` datatype                 | sensor/number                                            | sensor/number                                            | sensor/number                                                  | matrix                       |
| `boolean` datatype               | binary_sensor or semantic/fallback command entity        | binary_sensor or semantic/fallback command entity        | binary_sensor or semantic/fallback command entity              | matrix, soak                 |
| `string` datatype                | sensor/text                                              | sensor/text                                              | sensor/text                                                    | matrix                       |
| `enum` datatype                  | sensor/select/text                                       | sensor/select/text                                       | sensor/select/text                                             | golden, matrix               |
| `color` datatype                 | sensor/text                                              | sensor/text                                              | sensor/text                                                    | matrix                       |
| `datetime` datatype              | not in core spec                                         | not in core spec                                         | sensor timestamp or commandable text                           | matrix                       |
| `duration` datatype              | not in core spec                                         | not in core spec                                         | sensor duration or commandable text                            | matrix                       |
| `json` datatype                  | not in core spec                                         | not in core spec                                         | sensor with JSON attributes or commandable text                | golden, matrix, soak         |
| Numeric `$format`                | `min:max:step` parsed where present                      | `min:max:step` parsed where present                      | `min:max:step` parsed where present                            | matrix                       |
| Enum `$format`                   | comma options, doubled comma escape                      | comma options, doubled comma escape                      | comma options, doubled comma escape                            | golden, soak, matrix         |
| Boolean `format` / `$format`     | ignored for payloads; booleans use `false`/`true`        | ignored for payloads; booleans use `false`/`true`        | descriptive only; booleans use `false`/`true`                  | golden, matrix               |
| `settable` command topic         | `<property>/set` when true                               | `<property>/set` when true                               | `<property>/set` when true                                     | golden, matrix               |
| `$target`                        | not part of v3 core spec                                 | not part of v4 core spec                                 | left to device runtime; discovery uses state topic             | documented boundary          |
| `retained=false`                 | `force_update` for read-only sensors/binary sensors      | same                                                     | same                                                           | golden, matrix               |
| Recommended units                | preserved; common Home Assistant device classes inferred | preserved; common Home Assistant device classes inferred | preserved; common Home Assistant device classes inferred       | golden, matrix               |
| `$extensions` / `extensions`     | tolerated, not interpreted                               | tolerated, not interpreted                               | tolerated; non-operational `$...` can become diagnostics       | matrix, golden               |
| Firmware attributes              | known fields consumed                                    | known fields consumed                                    | observed `$fw/*` attributes consumed when present              | golden                       |
| Stats attributes                 | known `$stats/*` topics as diagnostic sensors            | known `$stats/*` topics as diagnostic sensors            | observed `$stats/*` attributes consumed when present           | golden                       |
| v5 extension attributes          | not applicable                                           | not applicable                                           | observed non-operational `$...` attributes become diagnostics  | golden                       |
| v5 parent/root hierarchy         | not applicable                                           | not applicable                                           | `parent` or `root` mapped to Home Assistant `via_device`       | golden                       |
| v5 children array                | not applicable                                           | not applicable                                           | tolerated; child devices publish their own metadata            | documented boundary          |
| v5 unknown fields                | not applicable                                           | not applicable                                           | ignored for forward compatibility                              | golden, fuzz                 |
| Compatible 5.x minor             | not applicable                                           | not applicable                                           | accepted as compatible major version                           | golden, fuzz                 |
| Future major                     | ignored with explicit warning                            | ignored with explicit warning                            | ignored with explicit warning                                  | bridge, fuzz                 |
| Broadcast topics                 | ignored by discovery bridge                              | ignored by discovery bridge                              | ignored by discovery bridge                                    | fuzz                         |
| Alert topics                     | not part of v3/v4 core discovery                         | extension/application behavior                           | application behavior, not Home Assistant discovery mapping yet | documented boundary          |
| Live property payload validation | not performed                                            | not performed                                            | not performed                                                  | documented boundary          |

## Homie v3/v4 Strategy

Homie v3.0.1 and v4.0.0 expose device topology through retained MQTT topics.
Real brokers may replay those topics in any order, and controllers may see
partial state during startup.

The legacy collector therefore:

- accepts metadata in any retained replay order;
- publishes discovery only when enough valid metadata is available;
- removes stale Home Assistant discovery when retained topology topics are
  deleted;
- warns on invalid IDs or unsupported datatypes instead of generating invalid
  entities;
- preserves deterministic component IDs for stable Home Assistant entity
  history.

Legacy support is covered by golden fixtures for normal, out-of-order, partial,
invalid and deletion scenarios.

## Homie v5+ Strategy

Homie v5 exposes topology in a retained `$description` JSON document under
`<domain>/5/<device-id>/$description`.

The v5 parser:

- accepts any compatible `homie: "5.x"` description;
- ignores unknown fields unless they conflict with required structure;
- preserves known future-oriented fields where they affect Home Assistant device
  relationships, such as `root` and `parent`;
- maps Home Assistant `via_device` to the direct Homie parent when `parent` is
  present, otherwise to `root`;
- adds conservative diagnostic entities for observed non-operational v5 `$...`
  attribute topics without hard-coding extension names;
- treats an empty retained `$description` payload as device removal;
- treats a valid description with no valid properties as removal if discovery was
  previously published.

The parser must not silently reinterpret a future major version as v5 or legacy
metadata. Numeric future-major control topics such as
`homie/6/<device>/$description` are ignored with a warning until a
version-specific parser and compatibility matrix are added. Legacy devices with
numeric IDs remain valid.

## Empty Payload Semantics

The Homie `develop` document states that MQTT empty string payloads are deletion
instructions for retained topics. The project follows that rule for discovery
metadata and cleanup. Actual empty string property values are a separate Homie
payload concern and must not be confused with retained metadata deletion.

## Capabilities Checklist

This checklist is the compact view of what is implemented today.

| Capability                   | v3/v4                                 | v5                                 |
| ---------------------------- | ------------------------------------- | ---------------------------------- |
| Device discovery             | Implemented                           | Implemented                        |
| Device removal cleanup       | Implemented                           | Implemented                        |
| Out-of-order retained replay | Implemented                           | Not applicable                     |
| Node arrays                  | Implemented for legacy array metadata | Not applicable                     |
| Parent/root device hierarchy | Not applicable                        | Implemented as `via_device`        |
| Integer/float                | Implemented                           | Implemented                        |
| Boolean                      | Implemented                           | Implemented                        |
| Enum                         | Implemented                           | Implemented                        |
| String                       | Implemented                           | Implemented                        |
| Color                        | Implemented as text/settable text     | Implemented as text/settable text  |
| Datetime                     | v5-only datatype                      | Implemented                        |
| Duration                     | v5-only datatype                      | Implemented                        |
| JSON                         | v5-only datatype                      | Implemented                        |
| Extensions                   | Not applicable                        | Tolerated, not interpreted         |
| Legacy firmware extension    | Implemented                           | Tolerated through extensions field |
| Legacy stats extension       | Implemented for known stats topics    | Tolerated through extensions field |
| Payload value validation     | Not handled by discovery bridge       | Not handled by discovery bridge    |

## Legacy Firmware Extension

The legacy firmware extension topics are consumed when present:

- `$fw/name`
- `$fw/version`
- `$mac`
- `$localip`

`$fw/version` is mapped to Home Assistant device `sw_version`. `$fw/name` is
used as the Home Assistant model when no Homie device `type` or override model
is available. `$mac` is exposed as a Home Assistant device connection.

`$localip` is collected for compatibility but is not currently exposed because a
bare IP address is not always a safe Home Assistant configuration URL.

## Legacy Stats Extension

Known `$stats/*` topics are mapped to diagnostic Home Assistant sensors:

| Homie topic       | Entity          |
| ----------------- | --------------- |
| `$stats/interval` | Stats Interval  |
| `$stats/uptime`   | Uptime          |
| `$stats/signal`   | Signal          |
| `$stats/cputemp`  | CPU Temperature |
| `$stats/cpuload`  | CPU Load        |
| `$stats/battery`  | Battery         |
| `$stats/freeheap` | Free Heap       |
| `$stats/supply`   | Supply          |

Stats entities are published only after the legacy device has declared at least
one node. This prevents a partial retained replay from creating a diagnostic-only
device before the actual topology is known.
