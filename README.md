# doimus-ariston-heater

Doimus native plugin for Ariston Velis / Lydos water heaters via the Ariston NET cloud API.

## Features

- Temperature monitoring (current and target)
- Target temperature adjustment
- Heating state (on/off) tracking and control
- **Adaptive polling**: fast when heating, slow when idle — no aggressive fixed-interval polling
- Configurable poll intervals and cooldown behavior
- Auto-discovery of plant ID (or manual override)
- Debug logging

## Adaptive Polling

The plugin automatically adjusts its poll rate based on the heater's state:

| Mode | When | Default interval |
|------|------|-----------------|
| **Fast** | Heater is actively heating | 120s (2 min) |
| **Cooldown** | 3 cycles after heating stops | 120s (2 min) |
| **Slow** | Heater is idle/off | 1800s (30 min) |

This means you see near-real-time temperature updates during heating (when it matters),
without hammering the Ariston cloud API when nothing is happening. The cooldown period
catches the thermal inertia after the element switches off.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `name` | string | `Ariston Heater` | Display name |
| `username` | string | — | Ariston NET account email |
| `password` | string | — | Ariston NET account password |
| `gateway` | string | — | Plant ID (auto-discovered if empty) |
| `pollInterval` | number | `1800` | Idle poll interval in seconds (min 300) |
| `fastPollInterval` | number | `120` | Heating poll interval in seconds (min 30) |
| `cooldownCycles` | number | `3` | Fast-poll cycles after heating stops (1-10) |
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
