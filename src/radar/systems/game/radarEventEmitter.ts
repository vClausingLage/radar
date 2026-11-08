import Phaser from "phaser";

export class RadarEventEmitter {
    private emitter: Phaser.Events.EventEmitter = new Phaser.Events.EventEmitter();

    // A weapon actually left the rail (not just a trigger pull) — carries the
    // fired weapon type so a listener (the player's own radio voice) can key
    // the matching Fox call.
    emitMissileFired(weaponType: string): void {
        this.emitter.emit('missile-fired', weaponType);
    }

    on(event: string, callback: (...args: unknown[]) => void): void {
        this.emitter.on(event, callback);
    }
}