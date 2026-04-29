# Discovery Overrides

Overrides let advanced users customize Home Assistant discovery without changing
Homie devices or patching code.

Overrides are optional. The default mapping is intentionally useful without any
configuration.

## Root Shape

```json
{
  "deviceDefaults": {
    "objectId": "homie_{deviceId}",
    "identifiers": ["homie:{baseTopic}"]
  },
  "namedNodeState": {
    "platform": "light",
    "objectId": "homie_{deviceId}_{nodeId}"
  },
  "devices": {
    "homie/5/kitchen": {
      "name": "Kitchen Board",
      "nodeNames": {
        "relay": "Kitchen Ceiling",
        "fan": {
          "name": "Extractor Fan",
          "platform": "fan"
        }
      }
    }
  }
}
```

`deviceDefaults` is optional. It applies shared Home Assistant device identity
fields before exact device overrides. Use it when many devices need the same
identifier, object id, manufacturer, model or `viaDevice` convention.

Device keys may be either:

- the full Homie base topic, such as `homie/5/kitchen`;
- the device id, such as `kitchen`.

Full base topic keys are preferred when multiple Homie roots may contain the
same device id.

## Mapping Priority

Property mapping is resolved in this order:

1. Built-in datatype mapping.
2. `defaultCommandableBooleanPlatform` automatic/fallback mapping for settable
   booleans.
3. `namedNodeState` shortcut for named settable boolean `state` properties.
4. Ordered `rules` cascade.
5. Exact device/node/property overrides.

Rules are applied in array order. Every matching rule is merged into the current
property override; later matching rules override earlier matching rules. Exact
property overrides, including object entries in `nodeNames`, always win over
rules.

This gives both simple defaults and absolute per-property control.

## Templates

String fields in `deviceDefaults`, device overrides and property overrides may
use templates. Unknown tokens are left unchanged.

| Token              | Meaning                                       |
| ------------------ | --------------------------------------------- |
| `{baseTopic}`      | Full Homie device base topic.                 |
| `{deviceId}`       | Homie device id.                              |
| `{majorVersion}`   | Homie major version when known.               |
| `{root}`           | Homie root before the version/device id.      |
| `{rootSlug}`       | Object-id-safe root.                          |
| `{nodeId}`         | Homie node id.                                |
| `{propertyId}`     | Homie property id.                            |
| `{path}`           | `nodeId/propertyId`.                          |
| `{nodeName}`       | Homie node display name when known.           |
| `{nodeType}`       | Homie node type when known.                   |
| `{propertyName}`   | Homie property display name when known.       |
| `{deviceObjectId}` | Generated Home Assistant device object id.    |
| `{platform}`       | Generated Home Assistant MQTT platform.       |
| `{entityObjectId}` | Generated Home Assistant entity object id.    |
| `{objectId}`       | Alias of `{entityObjectId}` for entity rules. |

For example:

```json
{
  "deviceDefaults": {
    "objectId": "lsh_{deviceId}",
    "identifiers": ["LSH_{deviceId}"],
    "manufacturer": "Jacopo Labardi",
    "model": "Labo Smart Home"
  },
  "namedNodeState": {
    "exclusive": true,
    "platform": "light",
    "objectId": "lsh_{deviceId}_{nodeId}",
    "defaultEntityId": "{platform}.{objectId}"
  },
  "devices": {
    "c1": {
      "nodeNames": {
        "1": "Esterno ingresso",
        "2": "Esterno camerina",
        "3": {
          "name": "Ventola",
          "platform": "fan"
        }
      }
    }
  }
}
```

## Named Node State

`namedNodeState` is the easiest way to map devices whose meaningful Home
Assistant entities are the `state` property of named Homie nodes. It applies to
settable boolean `state` properties on devices listed in `devices`, but only
when the node is present in `nodeNames` or `nodes`.

Set `exclusive` to `true` when unnamed settable boolean `state` properties on
those devices should be suppressed. This is useful for devices that expose
internal outputs or buttons in Homie but should only publish selected entities
to Home Assistant.

Use object entries in `nodeNames` for one-off exceptions. The `name` is both the
node display name and the default entity name; any other supported property
override field is applied to that node's `state` entity:

```json
{
  "namedNodeState": {
    "platform": "light"
  },
  "devices": {
    "homie/5/kitchen": {
      "nodeNames": {
        "ceiling": "Kitchen Ceiling",
        "extractor": {
          "name": "Extractor Fan",
          "platform": "fan",
          "icon": "mdi:fan"
        }
      }
    }
  }
}
```

## Device Overrides

```json
{
  "devices": {
    "homie/5/kitchen": {
      "name": "Kitchen Board",
      "objectId": "acme_kitchen",
      "manufacturer": "Acme",
      "model": "Bridge",
      "identifiers": ["kitchen-board-01"],
      "viaDevice": "homie:gateway"
    }
  }
}
```

| Field          | Type     | Meaning                                                          |
| -------------- | -------- | ---------------------------------------------------------------- |
| `name`         | string   | Home Assistant device name.                                      |
| `objectId`     | string   | Device discovery object id and config topic.                     |
| `manufacturer` | string   | Home Assistant manufacturer.                                     |
| `model`        | string   | Home Assistant model.                                            |
| `identifiers`  | string[] | Home Assistant device identifiers.                               |
| `viaDevice`    | string   | Home Assistant `via_device` value.                               |
| `nodeNames`    | object   | Compact map of node id to display name or state override object. |
| `nodes`        | object   | Node-level overrides.                                            |
| `properties`   | object   | Property overrides keyed by `node/property`.                     |

## Node Overrides

```json
{
  "devices": {
    "homie/5/kitchen": {
      "nodes": {
        "relay": {
          "name": "Ceiling Relay"
        }
      }
    }
  }
}
```

Node overrides currently support:

| Field        | Type   | Meaning                                       |
| ------------ | ------ | --------------------------------------------- |
| `name`       | string | Display name used for generated entity names. |
| `properties` | object | Property overrides for this node.             |

## Property Overrides

Property overrides may be declared under `device.properties`:

```json
{
  "devices": {
    "homie/5/kitchen": {
      "properties": {
        "relay/state": {
          "platform": "light",
          "name": "Kitchen Ceiling"
        }
      }
    }
  }
}
```

or under a node:

```json
{
  "devices": {
    "homie/5/kitchen": {
      "nodes": {
        "relay": {
          "properties": {
            "state": {
              "platform": "light",
              "name": "Kitchen Ceiling"
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
| `objectId`                  | string   | Explicit Home Assistant `unique_id` and default entity-id base.                         |
| `defaultEntityId`           | string   | Full Home Assistant entity id used on first discovery, such as `light.kitchen_ceiling`. |
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
| `ha`                        | object   | Advanced Home Assistant MQTT discovery fields not modeled above.                        |

`platform` is intentionally limited to platforms the mapper can produce safely:
`sensor`, `binary_sensor`, `switch`, `light`, `fan`, `number`, `select` and
`text`. More specialized Home Assistant MQTT domains need domain-specific
configuration fields and are not guessed from Homie datatype metadata.

### Advanced Home Assistant Fields

Use typed override fields first. They are portable across Node-RED, the CLI and
the library API, and they are validated with friendly errors.

For Home Assistant MQTT discovery fields that are not modeled directly, use the
`ha` object with native Home Assistant snake_case keys:

```json
{
  "devices": {
    "homie/5/kitchen": {
      "properties": {
        "temperature/value": {
          "expireAfter": 300,
          "suggestedDisplayPrecision": 1,
          "ha": {
            "availability": [
              {
                "topic": "homie/5/kitchen/$state",
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

`ha` is intentionally an advanced escape hatch. The validator rejects fields
managed by the mapper, such as `platform`, `unique_id`, `default_entity_id`,
`object_id`, `name`, `state_topic`, `command_topic`, `payload_on`,
`payload_off`, `device_class`, `state_class`, `unit_of_measurement`,
`value_template`, `json_attributes_topic`, `icon`, `entity_category`,
`options`, `min`, `max`, `step`, `mode`, `device` and `origin`. Use the typed
override fields for those values so discovery cleanup, entity identity and
platform migration remain deterministic.

## Mapping Rules

Use `rules` when many properties share a pattern. A rule has a required
`match` object and any supported property override fields.

All matcher fields are ANDed. String matchers accept exact strings, arrays of
strings, `*` and `?` globs.

For Homie v3 array nodes, `nodeId` and `path` match both the expanded entity
node id (`lights_1/state`) and the base array node id (`lights/state`). This
lets one rule cover every element of `lights[]`.

Supported matcher fields:

| Matcher          | Type               | Meaning                                                            |
| ---------------- | ------------------ | ------------------------------------------------------------------ |
| `baseTopic`      | string or string[] | Full Homie base topic.                                             |
| `deviceId`       | string or string[] | Homie device id.                                                   |
| `majorVersion`   | number or number[] | Homie major version: `3`, `4` or `5`.                              |
| `nodeId`         | string or string[] | Homie node id.                                                     |
| `propertyId`     | string or string[] | Homie property id.                                                 |
| `path`           | string or string[] | `nodeId/propertyId`, such as `fan/state`.                          |
| `nodeName`       | string or string[] | Homie node display name.                                           |
| `nodeType`       | string or string[] | Homie node type when available.                                    |
| `propertyName`   | string or string[] | Homie property display name.                                       |
| `datatype`       | string or string[] | Homie datatype.                                                    |
| `settable`       | boolean            | Homie commandability.                                              |
| `retained`       | boolean            | Homie retained flag.                                               |
| `unit`           | string or string[] | Homie unit.                                                        |
| `configuredNode` | boolean            | Whether this node has an explicit `nodes` or `nodeNames` override. |

Example with light, fan and generic switch booleans in the same installation:

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
    },
    {
      "match": {
        "nodeId": "fan",
        "propertyId": "state"
      },
      "platform": "fan"
    }
  ],
  "devices": {
    "homie/5/kitchen": {
      "properties": {
        "pump/state": {
          "platform": "light",
          "name": "Fountain Light"
        }
      }
    }
  }
}
```

In that example, settable booleans default to `switch`, `lights/*` becomes
`light`, `fan/state` becomes `fan`, and the exact `pump/state` override wins
for the kitchen device only.

## Legacy Array Nodes

Homie v3 array nodes expand from base node ids such as `doors` into concrete
node ids such as `doors_1`. Overrides may target either:

- `doors/position`, applying to every array element;
- `doors_1/position`, applying only to one expanded element.

## Preserving Existing Home Assistant Entities

When replacing an older Homie-to-Home-Assistant discovery bridge, preserve
Home Assistant history by keeping the old discovery object ids and unique ids:

```json
{
  "devices": {
    "c1": {
      "objectId": "acme_c1",
      "identifiers": ["acme-c1"],
      "properties": {
        "1/state": {
          "platform": "light",
          "name": "Kitchen Ceiling",
          "objectId": "acme_c1_1",
          "defaultEntityId": "light.acme_c1_1"
        }
      }
    }
  }
}
```

`device.objectId` controls the retained device discovery topic. Property
`objectId` controls the Home Assistant `unique_id` and default entity-id base
for that entity. Use `defaultEntityId` when the old bridge used a specific full
entity id, for example `light.acme_c1_1`. If both match the old bridge, Home
Assistant can continue using the same entity registry entries after the old
retained config has been removed.

## Runtime Validation

Overrides are validated at runtime. Invalid JSON, unsupported platforms,
unknown fields or wrong value types fail early in the CLI or Node-RED
constructor.

This is intentional: bad overrides can otherwise generate retained Home
Assistant discovery payloads that survive restarts.

## Complete Example

```json
{
  "devices": {
    "homie/5/kitchen": {
      "name": "Kitchen Board",
      "objectId": "acme_kitchen",
      "manufacturer": "Acme",
      "model": "DIN Relay",
      "identifiers": ["acme-kitchen-board"],
      "nodes": {
        "relay": {
          "name": "Relay",
          "properties": {
            "state": {
              "platform": "light",
              "name": "Kitchen Ceiling",
              "objectId": "kitchen_ceiling",
              "icon": "mdi:ceiling-light",
              "payloadOn": "ON",
              "payloadOff": "OFF"
            }
          }
        }
      },
      "properties": {
        "diagnostics/stats-signal": {
          "entityCategory": "diagnostic",
          "unit": "%"
        },
        "diagnostics/stats-mqtt-inbound-dropped": {
          "name": "MQTT Dropped Messages",
          "objectId": "acme_kitchen_mqtt_dropped",
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
