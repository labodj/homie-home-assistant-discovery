# Discovery Overrides

Use overrides to add the meaning that Homie core cannot know.

Most devices should work without overrides. Add them when you want clearer
names, stable historical Home Assistant IDs, a different platform for one
boolean property, an icon, a unit, or a Home Assistant discovery field that
needs human intent.

The basic idea is:

- use `deviceDefaults` for shared identity;
- use `namedNodeState` for the common `node/state` pattern;
- use `nodeNames` for friendly names and simple exceptions;
- use `rules` when many properties follow a pattern;
- use exact `properties` overrides when one entity must be configured fully.

## Start Small

This is the smallest practical override for a common relay board: every listed
node has a commandable boolean `state` property, most are lights, and one is a
fan.

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

That example is intentionally short:

- `ceiling/state` becomes a light named `Ceiling light`;
- `extractor/state` becomes a fan named `Extractor fan`;
- other unlisted nodes are left to the normal automatic mapper.

## Commented Shape

JSON itself does not allow comments. The block below is `jsonc` for learning;
remove the comments before using it as a real override file.

```jsonc
{
  // Defaults applied to every device before exact device overrides.
  "deviceDefaults": {
    // Device object ID used in the Home Assistant discovery topic.
    "objectId": "home_{deviceId}",

    // Stable Home Assistant device identifiers.
    "identifiers": ["homie:{baseTopic}"],

    // Optional fallback metadata.
    "manufacturer": "Homie",
    "model": "MQTT device",
  },

  // Shortcut for devices where the useful entity is node/state.
  "namedNodeState": {
    // The default platform for named commandable boolean state properties.
    "platform": "light",

    // Entity object ID template. This controls unique_id and default entity ID.
    "objectId": "home_{deviceId}_{nodeId}",

    // When true, only configured node/state entities are exposed for those devices.
    "exclusive": true,
  },

  // Pattern rules. Later matching rules override earlier matching rules.
  "rules": [
    {
      // Match every commandable boolean property under nodes named "garage-*".
      "match": {
        "nodeId": "garage-*",
        "datatype": "boolean",
        "settable": true,
      },

      // Make those matched properties switches unless a later rule or exact
      // override says otherwise.
      "platform": "switch",
    },
  ],

  // Device-specific names and exceptions.
  "devices": {
    // Prefer the full base topic when different Homie roots may reuse an id.
    "homie/5/kitchen-board": {
      // Friendly Home Assistant device name.
      "name": "Kitchen board",

      // Compact node ID -> entity name or state override map.
      "nodeNames": {
        "ceiling": "Ceiling light",
        "extractor": {
          "name": "Extractor fan",
          "platform": "fan",
          "icon": "mdi:fan",
        },
      },

      // Exact property override for one specific entity.
      "properties": {
        "temperature/value": {
          "name": "Kitchen temperature",
          "deviceClass": "temperature",
          "unit": "°C",
          "suggestedDisplayPrecision": 1,
        },
      },
    },
  },
}
```

## Mapping Priority

When more than one setting could apply, the bridge resolves mapping in this
order:

1. Built-in datatype mapping.
2. `defaultCommandableBooleanPlatform` for commandable booleans.
3. `namedNodeState` for configured `node/state` properties.
4. Ordered `rules`; every matching rule is merged, later rules win.
5. Exact device, node and property overrides.

This means broad defaults stay simple, while the most specific setting always
has the final word.

## Device Keys

Device overrides live under `devices`. A key can be:

- the full Homie base topic, for example `homie/5/kitchen-board`;
- the device ID, for example `kitchen-board`.

Use the full base topic when possible. It avoids ambiguity if two Homie roots
contain the same device ID.

## Templates

String fields in `deviceDefaults`, device overrides and property overrides may
use templates. Unknown tokens are left unchanged.

| Token               | Meaning                                    |
| ------------------- | ------------------------------------------ |
| `{baseTopic}`       | Full Homie device base topic.              |
| `{deviceId}`        | Homie device ID.                           |
| `{deviceIdUpper}`   | Homie device ID converted to upper case.   |
| `{majorVersion}`    | Homie major version when known.            |
| `{root}`            | Homie root before the version/device ID.   |
| `{rootSlug}`        | Object-ID-safe root.                       |
| `{nodeId}`          | Homie node ID.                             |
| `{nodeIdUpper}`     | Homie node ID converted to upper case.     |
| `{propertyId}`      | Homie property ID.                         |
| `{propertyIdUpper}` | Homie property ID converted to upper case. |
| `{path}`            | `nodeId/propertyId`.                       |
| `{nodeName}`        | Homie node display name when known.        |
| `{nodeType}`        | Homie node type when known.                |
| `{propertyName}`    | Homie property display name when known.    |
| `{deviceObjectId}`  | Generated Home Assistant device object ID. |
| `{platform}`        | Generated Home Assistant MQTT platform.    |
| `{entityObjectId}`  | Generated Home Assistant entity object ID. |
| `{objectId}`        | Alias of `{entityObjectId}` for entities.  |

Example:

```json
{
  "deviceDefaults": {
    "objectId": "home_{deviceId}",
    "identifiers": ["homie:{baseTopic}"]
  },
  "namedNodeState": {
    "platform": "light",
    "objectId": "home_{deviceId}_{nodeId}",
    "defaultEntityId": "{platform}.{objectId}"
  }
}
```

## Named Node State

`namedNodeState` is the most compact shortcut for devices whose useful Home
Assistant entities are commandable boolean `state` properties.

It applies only to devices listed under `devices`, and only to nodes listed in
`nodeNames` or `nodes`.

```json
{
  "namedNodeState": {
    "platform": "light",
    "objectId": "home_{deviceId}_{nodeId}"
  },
  "devices": {
    "homie/5/living-room": {
      "nodeNames": {
        "main": "Main light",
        "reading": "Reading light",
        "fan": {
          "name": "Ceiling fan",
          "platform": "fan"
        }
      }
    }
  }
}
```

Set `exclusive` to `true` when a configured device should expose only the named
`state` entities and suppress unnamed commandable boolean `state` properties.
That is useful for devices that also publish internal relays, buttons or service
signals that should not appear in Home Assistant.

## Device Overrides

Device overrides control the Home Assistant device object.

```json
{
  "devices": {
    "homie/5/kitchen-board": {
      "name": "Kitchen board",
      "objectId": "home_kitchen_board",
      "manufacturer": "Acme",
      "model": "DIN relay",
      "identifiers": ["kitchen-board-01"],
      "viaDevice": "homie:gateway"
    }
  }
}
```

| Field          | Type     | Meaning                                                          |
| -------------- | -------- | ---------------------------------------------------------------- |
| `name`         | string   | Home Assistant device name.                                      |
| `objectId`     | string   | Device discovery object ID and config topic.                     |
| `manufacturer` | string   | Home Assistant manufacturer.                                     |
| `model`        | string   | Home Assistant model.                                            |
| `identifiers`  | string[] | Home Assistant device identifiers.                               |
| `viaDevice`    | string   | Home Assistant `via_device` value.                               |
| `nodeNames`    | object   | Compact map of node ID to display name or state override object. |
| `nodes`        | object   | Node-level overrides.                                            |
| `properties`   | object   | Property overrides keyed by `node/property`.                     |

## Node Overrides

Node overrides rename a node and can contain property overrides.

```json
{
  "devices": {
    "homie/5/kitchen-board": {
      "nodes": {
        "relay": {
          "name": "Relay",
          "properties": {
            "state": {
              "platform": "light",
              "name": "Kitchen light"
            }
          }
        }
      }
    }
  }
}
```

| Field        | Type   | Meaning                                       |
| ------------ | ------ | --------------------------------------------- |
| `name`       | string | Display name used for generated entity names. |
| `properties` | object | Property overrides for this node.             |

## Property Overrides

Use a property override when you need exact control over one entity.

You can put it under `device.properties`:

```json
{
  "devices": {
    "homie/5/kitchen-board": {
      "properties": {
        "relay/state": {
          "platform": "light",
          "name": "Kitchen light"
        }
      }
    }
  }
}
```

or under `device.nodes.<nodeId>.properties`:

```json
{
  "devices": {
    "homie/5/kitchen-board": {
      "nodes": {
        "relay": {
          "properties": {
            "state": {
              "platform": "light",
              "name": "Kitchen light"
            }
          }
        }
      }
    }
  }
}
```

Supported property fields:

| Field                       | Type     | Meaning                                                                                 |
| --------------------------- | -------- | --------------------------------------------------------------------------------------- |
| `enabled`                   | boolean  | Set `false` to suppress the entity.                                                     |
| `platform`                  | string   | One of `sensor`, `binary_sensor`, `switch`, `light`, `fan`, `number`, `select`, `text`. |
| `name`                      | string   | Entity display name.                                                                    |
| `objectId`                  | string   | Explicit Home Assistant `unique_id` and default entity ID base.                         |
| `defaultEntityId`           | string   | Full Home Assistant entity ID used on first discovery, such as `light.kitchen_light`.   |
| `icon`                      | string   | Home Assistant icon, such as `mdi:ceiling-light`.                                       |
| `entityCategory`            | string   | `diagnostic` or `config`.                                                               |
| `deviceClass`               | string   | Home Assistant device class.                                                            |
| `stateClass`                | string   | `measurement`, `total`, `total_increasing`.                                             |
| `unit`                      | string   | Unit of measurement override.                                                           |
| `valueTemplate`             | string   | Home Assistant value template.                                                          |
| `jsonAttributesTopic`       | string   | Home Assistant JSON attributes topic.                                                   |
| `jsonAttributesTemplate`    | string   | Home Assistant JSON attributes template.                                                |
| `stateTopic`                | string   | MQTT state topic override.                                                              |
| `commandTopic`              | string   | MQTT command topic override.                                                            |
| `payloadOn`                 | string   | Boolean on payload.                                                                     |
| `payloadOff`                | string   | Boolean off payload.                                                                    |
| `forceUpdate`               | boolean  | Home Assistant `force_update`.                                                          |
| `enabledByDefault`          | boolean  | Home Assistant `enabled_by_default`.                                                    |
| `entityPicture`             | string   | Home Assistant entity picture URL.                                                      |
| `expireAfter`               | number   | Home Assistant `expire_after` seconds; must be greater than zero.                       |
| `suggestedDisplayPrecision` | number   | Home Assistant suggested display precision; must be a non-negative integer.             |
| `options`                   | string[] | Select options.                                                                         |
| `min`                       | number   | Number minimum.                                                                         |
| `max`                       | number   | Number maximum.                                                                         |
| `step`                      | number   | Number step; must be greater than zero.                                                 |
| `ha`                        | object   | Additional Home Assistant MQTT discovery fields not modeled above.                      |

`platform` is intentionally limited to platforms the mapper can produce safely:
`sensor`, `binary_sensor`, `switch`, `light`, `fan`, `number`, `select` and
`text`.

## Advanced Home Assistant Fields

Use typed override fields first. They are validated, portable across the CLI,
Node-RED and the library API, and they preserve deterministic cleanup.

When Home Assistant has a discovery field that is not modeled directly, put it
inside `ha` using native snake_case keys:

```json
{
  "devices": {
    "homie/5/kitchen-board": {
      "properties": {
        "temperature/value": {
          "expireAfter": 300,
          "suggestedDisplayPrecision": 1,
          "ha": {
            "availability": [
              {
                "topic": "homie/5/kitchen-board/$state",
                "payload_available": "ready",
                "payload_not_available": "lost"
              }
            ],
            "optimistic": false
          }
        }
      }
    }
  }
}
```

The `ha` object rejects fields managed by the mapper, such as `platform`,
`unique_id`, `default_entity_id`, `object_id`, `name`, `state_topic`,
`command_topic`, `payload_on`, `payload_off`, `device_class`, `state_class`,
`unit_of_measurement`, `value_template`, `json_attributes_topic`, `icon`,
`entity_category`, `options`, `min`, `max`, `step`, `mode`, `device` and
`origin`. Use the typed override fields for those values.

## Mapping Rules

Rules are useful when names, paths or datatypes follow a pattern.

All matcher fields are ANDed. String matchers accept exact strings, arrays of
strings, `*` and `?` globs.

Supported matcher fields:

| Matcher          | Type               | Meaning                                                            |
| ---------------- | ------------------ | ------------------------------------------------------------------ |
| `baseTopic`      | string or string[] | Full Homie base topic.                                             |
| `deviceId`       | string or string[] | Homie device ID.                                                   |
| `majorVersion`   | number or number[] | Homie major version: `3`, `4` or `5`.                              |
| `nodeId`         | string or string[] | Homie node ID.                                                     |
| `propertyId`     | string or string[] | Homie property ID.                                                 |
| `path`           | string or string[] | `nodeId/propertyId`, such as `fan/state`.                          |
| `nodeName`       | string or string[] | Homie node display name.                                           |
| `nodeType`       | string or string[] | Homie node type when available.                                    |
| `propertyName`   | string or string[] | Homie property display name.                                       |
| `datatype`       | string or string[] | Homie datatype.                                                    |
| `settable`       | boolean            | Homie commandability.                                              |
| `retained`       | boolean            | Homie retained flag.                                               |
| `unit`           | string or string[] | Homie unit.                                                        |
| `configuredNode` | boolean            | Whether this node has an explicit `nodes` or `nodeNames` override. |

Example with a broad default, a pattern and one exact exception:

```json
{
  "rules": [
    {
      "match": {
        "datatype": "boolean",
        "settable": true
      },
      "platform": "switch"
    },
    {
      "match": {
        "path": "lights/*"
      },
      "platform": "light"
    }
  ],
  "devices": {
    "homie/5/garden-board": {
      "properties": {
        "pump/state": {
          "platform": "switch",
          "name": "Fountain pump"
        }
      }
    }
  }
}
```

In that example, commandable booleans default to `switch`, `lights/*` becomes
`light`, and the exact `pump/state` override wins for one device only.

For Homie v3 array nodes, `nodeId` and `path` match both the expanded entity
node ID (`lights_1/state`) and the base array node ID (`lights/state`). This
lets one rule cover every element of `lights[]`.

## Legacy Array Nodes

Homie v3 array nodes expand from base node IDs such as `doors` into concrete
node IDs such as `doors_1`. Overrides may target either:

- `doors/position`, applying to every array element;
- `doors_1/position`, applying only to one expanded element.

## Preserving Existing Home Assistant Entities

When replacing another discovery bridge, preserve Home Assistant history by
keeping the old discovery object IDs and entity IDs.

```json
{
  "devices": {
    "kitchen-board": {
      "objectId": "old_kitchen_board",
      "identifiers": ["old-kitchen-board"],
      "properties": {
        "ceiling/state": {
          "platform": "light",
          "name": "Kitchen light",
          "objectId": "old_kitchen_light",
          "defaultEntityId": "light.old_kitchen_light"
        }
      }
    }
  }
}
```

`device.objectId` controls the retained device discovery topic. Property
`objectId` controls the Home Assistant `unique_id` and default entity ID base
for that entity. Use `defaultEntityId` when the old bridge used a specific full
entity ID, for example `light.old_kitchen_light`.

## Diagnostics and v5 Attributes

Observed Homie v5 `$...` attributes are matched under a synthetic
`diagnostics` node. For example:

- `$stats/uptime` matches `diagnostics/stats-uptime`;
- `$implementation/ota/enabled` matches `diagnostics/implementation-ota-enabled`.

Use exact property overrides to rename, disable or refine those diagnostics:

```json
{
  "devices": {
    "homie/5/kitchen-board": {
      "properties": {
        "diagnostics/stats-uptime": {
          "name": "Uptime",
          "icon": "mdi:timer-outline",
          "entityCategory": "diagnostic"
        },
        "diagnostics/implementation-config": {
          "enabled": false
        }
      }
    }
  }
}
```

## Runtime Validation

Overrides are validated at startup. Invalid JSON, unsupported platforms, unknown
fields or wrong value types fail early in the CLI, library constructor or
Node-RED runtime.

This early stop is intentional. Home Assistant discovery messages are retained
on MQTT, so it is safer to stop on an invalid override than to publish invalid
retained config.

## Complete Example

```json
{
  "deviceDefaults": {
    "objectId": "home_{deviceId}",
    "identifiers": ["homie:{baseTopic}"],
    "manufacturer": "Homie",
    "model": "MQTT device"
  },
  "namedNodeState": {
    "platform": "light",
    "objectId": "home_{deviceId}_{nodeId}",
    "exclusive": true
  },
  "devices": {
    "homie/5/kitchen-board": {
      "name": "Kitchen board",
      "nodeNames": {
        "ceiling": "Ceiling light",
        "extractor": {
          "name": "Extractor fan",
          "platform": "fan",
          "icon": "mdi:fan"
        }
      },
      "properties": {
        "temperature/value": {
          "name": "Kitchen temperature",
          "deviceClass": "temperature",
          "unit": "°C",
          "suggestedDisplayPrecision": 1
        },
        "diagnostics/stats-signal": {
          "entityCategory": "diagnostic",
          "unit": "%"
        },
        "diagnostics/stats-mqtt-inbound-dropped": {
          "name": "MQTT dropped messages",
          "icon": "mdi:counter",
          "unit": "messages",
          "stateClass": "total_increasing",
          "suggestedDisplayPrecision": 0
        },
        "diagnostics/implementation-config": {
          "enabled": false
        }
      }
    }
  }
}
```
