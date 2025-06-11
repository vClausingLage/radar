export interface BaseMissile {
    range: number;
    speed: number;
    warhead: 'high-explosive' | 'fragmentation';
    position: {
        x: number;
        y: number;
    };
    direction: {
        x: number;
        y: number;
    };
}

export interface SARHMissile extends BaseMissile {
    type: 'AIM-177';
    guidance: 'semi-active';
}

export interface ActiveRadarMissile extends BaseMissile {
    type: 'AIM-220';
    guidance: 'active';
}

export type Missile = SARHMissile | ActiveRadarMissile

export type Missiles = 'AIM-177' | 'AIM-220'