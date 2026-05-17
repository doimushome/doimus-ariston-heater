# doimus-ariston-heater

Doimus native plugin for Ariston Velis / Lydos water heaters via the Ariston NET cloud API.

## Features

- Temperature monitoring (current and target)
- Target temperature adjustment
- Heating state (on/off) tracking and control
- Configurable poll interval
- Auto-discovery of plant ID (or manual override)
- Debug logging

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `name` | string | `Ariston Heater` | Display name |
| `username` | string | — | Ariston NET account email |
| `password` | string | — | Ariston NET account password |
| `gateway` | string | — | Plant ID (auto-discovered if empty) |
| `pollInterval` | number | `1800` | State refresh interval in seconds (min 300) |
| `minTemp` | number | `40` | Minimum target temperature (°C) |
| `maxTemp` | number | `65` | Maximum target temperature (°C) |
| `debug` | boolean | `false` | Enable debug logging |

## Device Capabilities

| Capability | Description |
|------------|-------------|
| `temperature` | Current water temperature (°C) |
| `target_temp` | Target temperature setpoint (°C) |
| `heating_state` | 1 = heating, 0 = idle |
| `heating_mode` | 1 = on, 0 = off |

## License

MIT
