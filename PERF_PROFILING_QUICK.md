# Performance Profiling Quick Reference

## For Developers

### Enable Profiler (1 second setup)

1. Open `src/performance/profiler.ts`
2. Change line 24: `const DEBUG_PERFORMANCE = true;`
3. Refresh the game in browser

### Add Profiling to New Code (30 seconds)

```typescript
// 1. Import profiler
import { profileStart, profileStop } from '../performance/profiler';

// 2. Wrap your code
profileStart('my_new_system');
this.doWork();
profileStop('my_new_system');
```

### Read the Results

- Check browser console (F12) every 60 frames
- Look for "Performance Profiler" group
- Focus on systems with avg > 1ms per frame

### Common Systems to Profile

| What | Name |
|------|------|
| Main update loop | `mySystem_update` |
| Detection phase | `mySystem_detect` |
| Calculation phase | `mySystem_calculate` |
| Rendering | `mySystem_render` |

### Interpreting Results

```
Avg (all time): 0.234 ms  <- Your system's baseline
Avg (last 60): 0.231 ms   <- Recent average (more stable)
Min: 0.187 ms             <- Best case (no GC pauses)
Max: 0.412 ms             <- Worst case (GC or other interruptions)
```

**Target**: Keep most systems below 1ms. Systems over 2ms need optimization.

## For Performance Fixes

### Step 1: Profile First
Don't optimize blindly - measure the actual bottleneck.

### Step 2: Optimize Hot Paths
- Reduce object allocation in loops
- Cache expensive calculations
- Use object pooling for frequently created objects

### Step 3: Re-measure
Enable profiler again and verify improvement.

### Step 4: Set Baseline
Document the expected performance in code comments.

## Existing Instrumented Systems

| System | Current Avg | Target |
|--------|-------------|--------|
| IRST_update | ~0.3ms | < 1.0ms |
| missileGuidance_update | ~1.0ms | < 2.0ms |
| irSeeker_update | ~0.1ms | < 0.5ms |

## Gotchas

1. **First frame is slow** - JIT compilation makes first measurement unreliable
2. **GC pauses** - Occasional spikes are normal (garbage collection)
3. **Frame rate dependency** - Measure over many frames, not just one
4. **Profiler overhead** - When enabled, adds ~0.05ms per profiled section

## Quick Commands

| Action | How |
|--------|-----|
| Enable profiling | `DEBUG_PERFORMANCE = true` in profiler.ts |
| Disable profiling | `DEBUG_PERFORMANCE = false` |
| Adjust logging frequency | Change `DEBUG_PERFORMANCE_DUMP_INTERVAL` |
| View metrics | Check browser console every 60 frames |
