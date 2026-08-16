import Phaser from "phaser";

export class RadarEventEmitter {
    private emitter: Phaser.Events.EventEmitter = new Phaser.Events.EventEmitter();

    emitLockEvent(): void {
        this.emitter.emit('lock');
    }

    // Called on the TARGET's radar when it is being STT-illuminated.
    onRwrLock(): void {
        this.emitter.emit('rwr-lock');
    }

    // A weapon actually left the rail (not just a trigger pull) — carries the
    // fired weapon type so a listener (the player's own radio voice) can key
    // the matching Fox call.
    emitMissileFired(weaponType: string): void {
        this.emitter.emit('missile-fired', weaponType);
    }

    on(event: string, callback: (...args: unknown[]) => void): void {
        this.emitter.on(event, callback);
    }
    off(event: string, callback: (...args: unknown[]) => void): void {
        this.emitter.off(event, callback);
    }
}