import { Math } from 'phaser'

export interface Target {
    position: Math.Vector2;
    direction: Math.Vector2;
    speed: number;
    size: number;
}