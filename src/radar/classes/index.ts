export class EntityCircle extends Phaser.Geom.Circle {
    constructor(x: number, y: number, w: number, public id: string) {
        super(x, y, w);
    }
}