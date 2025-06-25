import { Missiles } from '../radar/entities/missiles'

export type Vector2 = {
    x: number
    y: number

    setTo?(): (x: number, y: number) => Vector2
}

export type RadarOptions = {
    range: number
    position: Vector2
    isScanning: boolean
    azimuth: number
    scanSpeed: number,
}

export type Mode = 'stt' | 'rws' | 'tws' | 'emcon'

export type Loadout = {
    [key in Missiles]: number
}

// only for radar.ts

export type ReturnSignal = {
    point: Vector2
    time: number
    step: number
    direction: Vector2
    speed: number
    distance: number
}