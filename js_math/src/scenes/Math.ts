import { Scene } from 'phaser';

export class Math  extends Scene
{
    constructor ()
    {
        super('Game');
    }

    preload ()
    {
        this.load.setPath('assets');
        
        this.load.image('background', 'bg.png');
        this.load.image('logo', 'logo.png');
    }

    create ()
    {
        const center = new Phaser.Math.Vector2(300, 300);
        var circle = new Phaser.Geom.Circle(center.x + 120, center.y, 20);
        
        var line = new Phaser.Geom.Line(center.x, center.y, 300, 400);
        
        line = Phaser.Geom.Line.SetToAngle(line, center.x, center.y, Phaser.Math.DegToRad(0 -90), 100);
        
        var line2 = new Phaser.Geom.Line(center.x, center.y, 300, 400);
        Phaser.Geom.Line.RotateAroundPoint(line2, center, Phaser.Math.DegToRad(-90));
        
        const graphics = this.add.graphics();
        graphics.lineStyle(2, 0xff0000, 1);
        graphics.strokeLineShape(line);
        
        graphics.lineStyle(2, 0x00ff00, 1);
        graphics.strokeLineShape(line2);

        graphics.fillStyle(0x98ff98, 1);
        graphics.fillCircleShape(circle);

        var isInterscting = Phaser.Geom.Intersects.LineToCircle(line2, circle);
        if (isInterscting) {
            var result = Phaser.Geom.Intersects.GetLineToCircle(line2, circle);
            if (result) {
                graphics.fillStyle(0xff0000, 1);
                result.forEach(point => {
                    graphics.fillCircle(point.x, point.y, 5);
                });
            }
        } else {
            console.log('not intersecting');
        }
    }
}
