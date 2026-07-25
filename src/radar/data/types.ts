/**
 * Exports shared Phaser game-logic types that are not directly related to the radar system.
 */

import { Asteroid } from "../../entities/asteroid";
import { PlayerShip, Target } from "../../entities/ship";
import { Vector2 } from "../../types";

export type Entity = PlayerShip | Target | Asteroid;

// What a radar needs from whatever it is mounted on: a world position and a
// boresight direction. Ships satisfy it structurally; so does the stationary
// dish-radar station, so both can drive the same Radar.
export interface RadarHost {
    readonly id: number;
    getPosition(): Vector2;
    getDirection(): number;
}

// Radar scan patterns. rws/tws/stt are the fighter's cone modes; dome is a full
// 360° search used by fixed early-warning radars (the dish station).
export type Mode = 'rws' | 'tws' | 'stt' | 'dome';

export type Loadout = {
    [key in string]: { load: number, active: boolean }
}

export type RadarOptions = {
    range: number
    position: Vector2
    isScanning: boolean
    azimuth: number
    scanSpeed: number,
}

export type ReturnSignal = {
    point: Vector2
    time: number
    step: number
    direction: Vector2
    speed: number
    distance: number
}