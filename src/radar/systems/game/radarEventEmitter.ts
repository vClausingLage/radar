export class RadarEventEmitter {
    private emitter: Phaser.Events.EventEmitter = new Phaser.Events.EventEmitter();

    emitLockEvent(): void {
        this.emitter.emit('lock');
    }

    // Called on the TARGET's radar when it is being STT-illuminated.
    onRwrLock(): void {
        this.emitter.emit('rwr-lock');
    }

    on(event: string, callback: () => void): void {
        this.emitter.on(event, callback);
    }
    off(event: string, callback: () => void): void {
        this.emitter.off(event, callback);
    }
}