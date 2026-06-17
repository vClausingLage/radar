import { Loadout } from "../../data/types";
import { playerShipSettings } from "../../../settings";

export class LoadoutManager {
    private loadout: Loadout = playerShipSettings.LOADOUT;
    private activeType: string = 'VIM-177';

    setLoadout(loadout: Loadout): void {
        this.loadout = loadout;
    }
    getLoadout(): Loadout {
        return this.loadout;
    }
    getActiveType(): string {
        return this.activeType;
    }

    cycleActive(): void {
        const types = Object.keys(this.loadout);
        const idx = types.indexOf(this.activeType);
        this.activeType = types[(idx + 1) % types.length];
        // Sync the per-entry active flag so the HUD and firing logic agree.
        for (const type of types) {
            this.loadout[type].active = type === this.activeType;
        }
    }

    decrementLoad(type: string): void {
        if (this.loadout[type]) {
            this.loadout[type].load = Math.max(0, this.loadout[type].load - 1);
        }
    }
}