export interface SARHMissile {
    type: 'AIM-177'
    range: number
    speed: number
    guidance: 'semi-active'
    warhead: 'high-explosive' | 'fragmentation'
    position: {
        x: number
        y: number
    }
}

export interface ActiveRadarMissile {
    type: 'AIM-220'
    range: number
    speed: number
    guidance: 'active'
    warhead: 'high-explosive' | 'fragmentation'
    position: {
        x: number
        y: number
    }
}

export type Missile = SARHMissile | ActiveRadarMissile