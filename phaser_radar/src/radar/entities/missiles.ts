export interface BaseMissile {
    burnTime: number;
    speed: number;
    turnSpeed: number;
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
    burnTime: 14;
    speed: 17.0;
    turnSpeed: 0.7
}

export interface ActiveRadarMissile extends BaseMissile {
    type: 'AIM-220';
    guidance: 'active';
    burnTime: 14;
    speed: 21;
    turnSpeed: 0.8;
}

export type Missile = SARHMissile | ActiveRadarMissile

export type Missiles = 'AIM-177' | 'AIM-220'