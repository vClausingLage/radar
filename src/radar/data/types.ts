/**
 * Exports shared Phaser game-logic types that are not directly related to the radar system.
 */

import { Asteroid } from "../../entities/asteroid";
import { PlayerShip, Target } from "../../entities/ship";
import { Vector2 } from "../../types";

export type Entity = PlayerShip | Target | Asteroid;

export type Mode = 'rws' | 'tws' | 'stt';

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