# Performance Profiling Implementation

## Overview

This document describes the performance profiling infrastructure added to measure system overhead for IRST and missile guidance systems.

## Architecture

### Core Profiler (`src/performance/profiler.ts`)

A zero-dependency profiling module that:

1. **Measures Execution Time** - Uses `performance.now()` or `Date.now()` for accurate timing
2. **Tracks Per-System Metrics** - Maintains statistics per instrumented system
3. **Historical Sampling** - Keeps last 60 samples (1 second at 60fps) per system
4. **Configurable Activation** - Enabled via `DEBUG_PERFORMANCE` flag
5. **Periodic Dumping** - Logs metrics every 60 frames when active

### Key Features

- **Zero runtime cost when disabled** - Compiles to no-ops when `DEBUG_PERFORMANCE = false`
- **Minimal overhead** - Simple start/stop timing with Map-based storage
- **Detailed metrics**:
  - Total samples and cumulative time
  - Average, min, max per system
  - Recent sample history for trend analysis

## Instrumented Systems

### IRST (Infrared Search and Track)

| Metric | Description |
|--------|-------------|
| `IRST_update` | Full update cycle (detection → resolution → association → tracking) |
| `IRST_track` | Tracking mode update with narrow FOV |
| `IRST_detect` | Detecting hot sources within field of regard |
| `IRST_resolve` | Merging nearby detections by bearing |
| `IRST_associate` | Scan-to-scan association by bearing gate |

### Missile Guidance

| Metric | Description |
|--------|-------------|
| `missileGuidance_update` | Main guidance loop for all missiles |
| `missileGuidance_age` | Missile aging and burnout check |
| `missileGuidance_infrared` | VIM-90 seeker guidance (proportional navigation) |
| `missileGuidance_missileType` | ARH/SARH guidance selection |

### IR Seeker (VIM-90 Missile)

| Metric | Description |
|--------|-------------|
| `irSeeker_acquire` | Initial acquisition on cue |
| `irSeeker_update` | In-flight seeker update (gimbal slewing, source tracking) |

## Usage

### Basic Usage

```typescript
import { profiler, profileStart, profileStop } from '../performance/profiler';

// Wrap code sections
profileStart('my_system');
// ... code to profile ...
profileStop('my_system');
```

### Helper Function

```typescript
import { measure } from '../performance/profiler';

// Measure function execution
const result = measure('expensive_calculation', () => {
    return computeSomethingComplex();
});
```

### Manual Instrumentation

```typescript
class MySystem {
    update(): void {
        profileStart('mySystem_update');
        
        this.phase1();
        
        profileStart('mySystem_phase2');
        this.phase2();
        profileStop('mySystem_phase2');
        
        this.phase3();
        
        profileStop('mySystem_update');
    }
}
```

### Global Frame Marker

```typescript
// Call once per frame after all systems update
profiler.frame();
```

## Profiler Output

When enabled, console output appears every 60 frames:

```
Performance Profiler
Frame 60 (60 frames)

IRST_update:
  Total samples: 60
  Avg (all time): 0.234 ms
  Avg (last 60): 0.231 ms
  Min: 0.187 ms
  Max: 0.412 ms

missileGuidance_update:
  Total samples: 60
  Avg (all time): 1.127 ms
  Avg (last 60): 1.098 ms
  Min: 0.892 ms
  Max: 1.842 ms
```

## Configuration

### Enable Profiling

Edit `src/performance/profiler.ts`:

```typescript
const DEBUG_PERFORMANCE = true;  // Set to true to enable
const DEBUG_PERFORMANCE_DUMP_INTERVAL = 60;  // Dump every N frames
```

### Adjust Sample History

```typescript
const SAMPLE_HISTORY = 60;  // Number of recent samples to keep
```

## Implementation Details

### Thread-Safety

The profiler is single-threaded by design - it runs on the main game thread.

### Memory Usage

- ~200 bytes per instrumented system (5-10 systems)
- ~1KB for sample history (60 samples × ~17 bytes each)
- Total: ~1-2KB when active

### Compilation

When `DEBUG_PERFORMANCE = false`, the profiler compiles to minimal overhead:
- Function calls become no-ops
- Class methods are dead code eliminated
- No runtime allocations

## Performance Targets

Target overheads for production:

| System | Max Time per Frame |
|--------|-------------------|
| IRST_update | < 1.0 ms |
| missileGuidance_update | < 2.0 ms |
| irSeeker_update | < 0.5 ms |

## Troubleshooting

### No Output When Enabled

1. Check browser console for profiler errors
2. Verify `DEBUG_PERFORMANCE = true` in `profiler.ts`
3. Check that `profiler.frame()` is called in the game loop

### High Overhead

If profiler itself impacts performance:

1. Increase `DEBUG_PERFORMANCE_DUMP_INTERVAL` (less frequent logging)
2. Reduce `SAMPLE_HISTORY` (less memory allocation)
3. Remove profiling from hot paths temporarily

### Inconsistent Measurements

1. Ensure system is warm (first measurement includes JIT compilation)
2. Check for garbage collection between measurements
3. Verify consistent sample count (60 frames minimum for stable averages)
