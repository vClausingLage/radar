import { Vector2 } from '../types';

export class AiUnitController {
    constructor(private position: Vector2 | null = null,
                private direction: Vector2 | null = null,
    ) {}

    setPosition(position: Vector2) {
        this.position = position;
    }
    setDirection(direction: Vector2) {
        this.direction = direction;
    }

    update() {
        console.log('AI Unit Controller update called', this.position, this.direction);
    }

    destroy() {
        // Clean up resources if needed
        console.log('AI Unit Controller destroyed');
    }
}