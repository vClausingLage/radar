/**
 * Exports shared Phaser game-logic types that are not directly related to the radar system.
 */

import Phaser from "phaser";
import { Asteroid } from "../../entities/asteroid";
import { Structure } from "../../entities/structure";
import { PlayerShip, Target } from "../../entities/ship";
import { Vector2 } from "../../types";

// Solid, radar-opaque world geometry: drifting rock and fixed scenery alike.
// It shadows whatever is behind it and paints on the ground map; it is never
// a track. One Matter body each — the raycaster reads its vertices.
export type Terrain = Asteroid | Structure;

export type Entity = PlayerShip | Target | Terrain;

// What a radar needs from whatever it is mounted on: a world position and a
// boresight direction. Ships satisfy it structurally; so does the stationary
// dish-radar station, so both can drive the same Radar.
export interface RadarHost {
    readonly id: number;
    getPosition(): Vector2;
    getDirection(): number;
}

// Radar scan patterns. rws/tws/stt are the fighter's cone modes; dome is a full
// 360° search used by fixed early-warning radars (the dish station); emcon
// (Emission Control) shuts the transmitter down entirely — no pulses, no
// outbound illumination, no active radio — while still passively receiving
// RWR warnings and incoming radio traffic.
export type Mode = 'rws' | 'tws' | 'stt' | 'dome' | 'emcon';

// A volume of radar-absorbing medium (a gas cloud) as the signal path sees it:
// a capsule of `radius` px around the spine `line`, whose `density` (0..1) sets
// how much energy each pixel of path through it absorbs. The radar never sees
// the GasCloud entity itself — only this, the way it only sees decoys as
// circles.
export type GasVolume = {
    line: Phaser.Geom.Line;
    radius: number;
    density: number;
}

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