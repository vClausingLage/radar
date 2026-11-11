// Performance profiler for measuring system overhead
// Usage: Wrap code sections with start/stop calls, then dump metrics
// Only active when DEBUG_PERFORMANCE is set; compiles to no-ops otherwise.

type TimingSample = {
    durationMs: number;
    frameId: number;
};

type SystemMetrics = {
    name: string;
    totalSamples: number;
    totalMs: number;
    minMs: number;
    maxMs: number;
    lastSamples: TimingSample[];
};

type MetricsMap = Map<string, SystemMetrics>;

// Keep last 60 samples (1 second at 60fps) per system
const SAMPLE_HISTORY = 60;

const DEBUG_PERFORMANCE = false;
const DEBUG_PERFORMANCE_DUMP_INTERVAL = 60; // Dump every N frames

class PerformanceProfiler {
    private active = DEBUG_PERFORMANCE;
    private metrics: MetricsMap = new Map();
    private frameCount = 0;
    private lastDumpFrame = 0;
    // Open start() timestamps by section name, cleared by the matching stop().
    private startTimes = new Map<string, number>();

    private getOrCreateMetrics(name: string): SystemMetrics {
        if (!this.metrics.has(name)) {
            this.metrics.set(name, {
                name,
                totalSamples: 0,
                totalMs: 0,
                minMs: Infinity,
                maxMs: 0,
                lastSamples: [],
            });
        }
        return this.metrics.get(name)!;
    }

    private now(): number {
        // Use performance.now() if available, otherwise Date.now()
        if (typeof performance !== 'undefined' && performance.now) {
            return performance.now();
        }
        return Date.now();
    }

    start(name: string): void {
        if (!this.active) return;
        
        this.getOrCreateMetrics(name);
        this.startTimes.set(name, this.now());
    }

    stop(name: string): void {
        if (!this.active) return;
        
        const metrics = this.getOrCreateMetrics(name);
        const startTime = this.startTimes.get(name);
        
        if (startTime === undefined) {
            console.warn(`PerformanceProfiler: stop() called without matching start() for ${name}`);
            return;
        }
        
        const durationMs = this.now() - startTime;
        this.startTimes.delete(name);
        
        metrics.totalSamples++;
        metrics.totalMs += durationMs;
        metrics.minMs = Math.min(metrics.minMs, durationMs);
        metrics.maxMs = Math.max(metrics.maxMs, durationMs);
        
        // Keep last N samples for trend analysis
        metrics.lastSamples.push({ durationMs, frameId: this.frameCount });
        if (metrics.lastSamples.length > SAMPLE_HISTORY) {
            metrics.lastSamples.shift();
        }
    }

    // Call once per frame to handle periodic tasks like dumping
    frame(): void {
        if (!this.active) return;
        
        this.frameCount++;
        
        // Dump metrics periodically
        if (this.frameCount - this.lastDumpFrame >= DEBUG_PERFORMANCE_DUMP_INTERVAL) {
            this.dump();
            this.lastDumpFrame = this.frameCount;
        }
    }

    // Dump current metrics to console
    dump(): void {
        if (!this.active) return;
        
        console.group('Performance Profiler');
        console.log(`Frame ${this.frameCount} (${DEBUG_PERFORMANCE_DUMP_INTERVAL} frames)`);
        console.log('');
        
        for (const metrics of this.metrics.values()) {
            const avgMs = metrics.totalMs / metrics.totalSamples;
            const lastAvgMs = metrics.lastSamples.reduce((sum, s) => sum + s.durationMs, 0) / 
                            metrics.lastSamples.length || 0;
            
            console.log(`${metrics.name}:`);
            console.log(`  Total samples: ${metrics.totalSamples}`);
            console.log(`  Avg (all time): ${avgMs.toFixed(3)} ms`);
            console.log(`  Avg (last ${metrics.lastSamples.length}): ${lastAvgMs.toFixed(3)} ms`);
            console.log(`  Min: ${metrics.minMs.toFixed(3)} ms`);
            console.log(`  Max: ${metrics.maxMs.toFixed(3)} ms`);
            console.log('');
        }
        
        console.groupEnd();
    }

    // Get current metrics for external analysis or HUD display
    getMetrics(): SystemMetrics[] {
        if (!this.active) return [];
        return Array.from(this.metrics.values());
    }

    // Check if profiler is active (for conditional compilation)
    isEnabled(): boolean {
        return this.active;
    }
}

// Singleton instance
const profiler = new PerformanceProfiler();

export { profiler, type SystemMetrics };

// Convenience functions for non-class usage
export const profileStart = (name: string): void => profiler.start(name);
export const profileStop = (name: string): void => profiler.stop(name);
export const profileFrame = (): void => profiler.frame();

// Utility: measure function execution
export function measure<T>(name: string, fn: () => T): T {
    if (!profiler.isEnabled()) {
        return fn();
    }
    
    profiler.start(name);
    try {
        return fn();
    } finally {
        profiler.stop(name);
    }
}
