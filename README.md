# Radar

## Quick Start

This is a radar simulation game built with Phaser. The game simulates aircraft radar systems including RWS (radar search), TWS (track-while-scan), STT (single-target track), IRST (infrared search and track), and missile guidance.

### Developer Setup

1. Install dependencies: `npm install`
2. Run dev server: `npm start`
3. Open browser to `http://localhost:8080`

### Testing

Run radar tests from the start menu (DEV only) or via `window.runRadarTests()`.

### Performance Profiling

The game includes a performance profiling infrastructure to measure system overhead for IRST and missile guidance systems. This helps identify bottlenecks and optimize rendering performance.

#### Enabling Profiler

To enable the profiler, set `DEBUG_PERFORMANCE = true` in `src/performance/profiler.ts`. When enabled, metrics are logged to the console every 60 frames showing:

- Total samples and cumulative time per system
- Average, minimum, and maximum frame times
- Recent sample history for trend analysis

#### Instrumented Systems

| System | Measurement |
|--------|-------------|
| `IRST_update` | Full IRST update cycle |
| `IRST_track` | Tracking mode (narrow FOV) |
| `IRST_detect` | Detection in field of regard |
| `IRST_resolve` | Bearing resolution and merging |
| `IRST_associate` | Scan-to-scan association |
| `missileGuidance_update` | Missile guidance loop |
| `missileGuidance_infrared` | VIM-90 seeker guidance |
| `irSeeker_acquire` | Initial seeker acquisition |
| `irSeeker_update` | Seeker update during flight |

## Gameplay

**Tweak** radar behaviour and entities' settings in ´radarGameSettings.ts´. 