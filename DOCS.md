# Documentation

This package is the standalone Homie-to-Home-Assistant discovery bridge. The
README gives a short first run; this page keeps the rest of the documentation
easy to navigate.

## Start Here

Read these in order if you are setting up the bridge for the first time:

1. [README](README.md) for the package purpose, the quick CLI path, and a small
   override example.
2. [Usage](docs/USAGE.md) for CLI options, environment variables, TLS, the
   library API, and the MQTT adapter.
3. [Discovery overrides](docs/OVERRIDES.md) when Home Assistant needs friendlier
   names, stable historical IDs, or a more specific entity platform.

That path is enough for most installations.

## Common Tasks

| Task                                                        | Read this first                                         |
| ----------------------------------------------------------- | ------------------------------------------------------- |
| Run the bridge as a standalone service                      | [Usage](docs/USAGE.md#standalone-cli)                   |
| Configure broker credentials, TLS, or MQTT v5               | [Usage](docs/USAGE.md#mqtt-credentials-and-tls)         |
| Choose how Homie properties become Home Assistant entities  | [Discovery mapping](docs/HOME_ASSISTANT_DISCOVERY.md)   |
| Rename entities or preserve existing Home Assistant history | [Discovery overrides](docs/OVERRIDES.md)                |
| Map common `node/state` booleans to lights/fans             | [Named node state](docs/OVERRIDES.md#named-node-state)  |
| Embed the mapper in another Node.js application             | [Library API](docs/USAGE.md#library-api)                |
| Let this package manage MQTT from code                      | [MQTT adapter](docs/USAGE.md#programmatic-mqtt-adapter) |
| Check exact Homie v3/v4/v5 behavior                         | [Homie compatibility](docs/HOMIE_COMPATIBILITY.md)      |

## Choose the Right Package

Use this package when you want a standalone process, a library, or a
programmatic MQTT adapter.

Use
[`node-red-contrib-homie-home-assistant-discovery`](https://github.com/labodj/node-red-contrib-homie-home-assistant-discovery)
when Node-RED is the place where you already manage MQTT connections. The
Node-RED package wraps this core with editor fields, runtime status, diagnostics,
dynamic subscription messages, and normal Node-RED outputs.

Both packages use the same mapping engine and the same override model. A tested
override file can usually move between the CLI, the library API, and the
Node-RED editor with only formatting changes.

## Project Scope

This bridge is about discovery metadata: Homie device descriptions in, retained
Home Assistant MQTT discovery payloads out.

It does not replace your MQTT broker, validate live property values, or decide
what your automations should do. Home Assistant entities subscribe directly to
the generated Homie state topics and publish directly to the generated Homie
command topics.

## Mapping Philosophy

The mapper is conservative by default. It uses Homie metadata when the meaning
is clear, and it leaves human intent to overrides when Homie core is too
generic.

That is why generic commandable booleans become `switch` by default, while
lights, fans, stable names, device classes, icons, historical IDs, and Home
Assistant fields beyond conservative inference belong in explicit overrides.
