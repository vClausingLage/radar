export function renderTrack(scene: Phaser.Scene, point: {x:number, y: number}) {
    const yellowDot = scene.add.graphics();
    yellowDot.fillStyle(0xffff00, 1);
    yellowDot.fillPoint(point.x, point.y, 4);
    scene.time.addEvent({
        delay: 9000,
        callback: () => {
            yellowDot.clear();
        },
        callbackScope: scene
    });
}