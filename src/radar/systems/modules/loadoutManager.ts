import { Loadout } from "../../data/types";
import { playerShipSettings } from "../../../settings";

export class LoadoutManager {
    // Deep-copied so every ship owns its own missile inventory — assigning the
    // shared settings object directly would make all ships drain one pool.
    private loadout: Loadout = structuredClone(playerShipSettings.LOADOUT);
    private activeType: string = 'VIM-177';

    setLoadout(loadout: Loadout): void {
        this.loadout = structuredClone(loadout);
    }
    getLoadout(): Loadout {
        return this.loadout;
    }
    getActiveType(): string {
        return this.activeType;
    }
    getLoad(type: string): number {
        return this.loadout[type]?.load ?? 0;
    }

    cycleActive(): void {
        const types = Object.keys(this.loadout);
        const idx = types.indexOf(this.activeType);
        this.setActiveType(types[(idx + 1) % types.length]);
    }

    // Directly select a weapon (AI fire-control). No-op for unknown types.
    setActiveType(type: string): void {
        if (!this.loadout[type]) return;
        this.activeType = type;
        // Sync the per-entry active flag so the HUD and firing logic agree.
        for (const t of Object.keys(this.loadout)) {
            this.loadout[t].active = t === type;
        }
    }

    decrementLoad(type: string): void {
        if (this.loadout[type]) {
            this.loadout[type].load = Math.max(0, this.loadout[type].load - 1);
        }
    }
}