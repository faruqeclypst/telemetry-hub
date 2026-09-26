# TelemetryHub Design Direction

## Mood

Engineering pit wall. The app should read like a race engineer's workstation, not a
marketing page. Data density is high, but hierarchy keeps it legible. Nothing is
decorated unless it carries information.

## Theme

Dark only. This is an analysis tool used for long sessions with a live chart and a
3D viewport; a light theme would fight the canvas rendering. No toggle is shipped.

## Palette

Base layers (never pure black):

| Token | Value | Use |
|---|---|---|
| `--bg-app` | `#0B0E13` | App background |
| `--bg-surface` | `#11151C` | Panels |
| `--bg-raised` | `#171C24` | Controls, table headers |
| `--bg-sunken` | `#0D1116` | Chart and viewport wells |
| `--border-dim` | `#232B36` | Dividers |
| `--border-mid` | `#333D4B` | Control outlines |

Text: `--text-main #E8EDF2`, `--text-muted #9AA6B2`, `--text-dim #6B7785`.
All three are checked against `--bg-surface` for WCAG AA (4.5:1 body, 3:1 large).

Accents, each with a job:

| Token | Value | Meaning |
|---|---|---|
| `--accent-ref` | `#FF8A3D` | Reference lap, active selection |
| `--accent-comp` | `#35C7F0` | Comparison lap, secondary actions |
| `--gain` | `#3FD68C` | Time gained |
| `--loss` | `#FF5C5C` | Time lost |
| `--warn` | `#F5B03E` | Kerb contact, pit lap, limits |

Channel colors are data, not decoration: `--ch-throttle`, `--ch-brake`, `--ch-rpm`,
`--ch-gear`, `--ch-speed`, `--ch-gforce`, `--ch-steer`.

## Typography

- UI and display: **Saira** (400/500/600/700). A grotesk with motorsport lineage
  (used across motorsport broadcast and timing graphics), tighter and more
  characterful than the Inter default.
- Numbers: **JetBrains Mono** with `font-variant-numeric: tabular-nums` so digits do
  not shift during replay.
- Labels: uppercase, 0.68rem, letter-spacing 0.06em, `--text-dim`. Used only for
  field labels, never as decorative section headers.

## Dials

**ENERGY 3 / RHYTHM 3 / MOTION 3.**

- ENERGY 3 = information-dense and assertive. One focal point per screen; everything
  else steps down. Density is the energy, not extra color.
- RHYTHM 3 = sections have different compositions: a full-width timing strip, a
  2:1 chart/map split, a compact corner rail, a dense table. No repeated card grid.
- MOTION 3 = motion exists where it carries meaning: chart crosshair tracking,
  timeline scrub, corner focus transitions, chase camera, replay. No fade-up on
  static panels.

## Identity motif

The pit board: a vertical timing strip of corner entries with a monospace corner
number in a bordered tab on the left edge. The same tab shape marks the active
corner in the map and the 3D viewport. Reused everywhere, never restyled.

## Rules for every screen

- Loading, empty, and error states are designed, not defaulted.
- No horizontal overflow. Tap targets at least 44px on touch breakpoints.
- Every control performs a real action. No dead buttons.
- Keyboard reachable, visible focus ring (`2px solid var(--accent-ref)`, 2px offset).
- Modals close with Escape.
- No numbers without a data source. No buzzwords. No em dashes.
