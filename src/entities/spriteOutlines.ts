import { Vector2 } from "../types";

// Sprite silhouettes as Matter body polygons, in texture pixel space (origin at
// the texture's top-left corner, unscaled). Phaser has no shape editor; these
// are traced from each PNG's alpha channel with tools/traceOutline.js and
// pasted here — re-run it whenever a sprite changes. (The alternative is
// PhysicsEditor, whose JSON export Phaser loads with type: 'fromPhysicsEditor'.)
//
// Concave outlines are fine: the body keeps the polygon as drawn (see
// physics/bodyShape.ts), so a dent in the rock or the gap under the reflector
// shadows and echoes exactly as drawn.

// The dish station's rock.
//   node tools/traceOutline.js public/asteroid_2.png 6 0.5
export const ASTEROID_2_OUTLINE: Vector2[] = [
    { x: 333, y: 12 },
    { x: 611, y: 68 },
    { x: 861, y: 59 },
    { x: 897, y: 62 },
    { x: 959, y: 85 },
    { x: 997, y: 125 },
    { x: 1049, y: 156 },
    { x: 1087, y: 241 },
    { x: 1130, y: 285 },
    { x: 1126, y: 333 },
    { x: 1086, y: 428 },
    { x: 1063, y: 455 },
    { x: 1007, y: 487 },
    { x: 967, y: 485 },
    { x: 912, y: 505 },
    { x: 852, y: 500 },
    { x: 784, y: 526 },
    { x: 750, y: 522 },
    { x: 614, y: 544 },
    { x: 540, y: 569 },
    { x: 460, y: 554 },
    { x: 447, y: 559 },
    { x: 408, y: 545 },
    { x: 357, y: 554 },
    { x: 314, y: 549 },
    { x: 290, y: 542 },
    { x: 260, y: 512 },
    { x: 219, y: 510 },
    { x: 168, y: 489 },
    { x: 149, y: 477 },
    { x: 128, y: 428 },
    { x: 105, y: 411 },
    { x: 99, y: 385 },
    { x: 40, y: 324 },
    { x: 17, y: 263 },
    { x: 29, y: 214 },
    { x: 61, y: 166 },
    { x: 99, y: 131 },
    { x: 130, y: 117 },
    { x: 212, y: 108 },
    { x: 296, y: 28 },
    { x: 332, y: 13 },
];

// The dish antenna itself: reflector, feed struts and pedestal building.
//   node tools/traceOutline.js public/dish_radar.png 6 0.5
export const DISH_RADAR_OUTLINE: Vector2[] = [
    { x: 240, y: 95 },
    { x: 313, y: 97 },
    { x: 380, y: 112 },
    { x: 442, y: 136 },
    { x: 524, y: 185 },
    { x: 581, y: 231 },
    { x: 641, y: 298 },
    { x: 697, y: 402 },
    { x: 709, y: 458 },
    { x: 707, y: 518 },
    { x: 682, y: 573 },
    { x: 635, y: 619 },
    { x: 580, y: 645 },
    { x: 507, y: 664 },
    { x: 442, y: 668 },
    { x: 380, y: 651 },
    { x: 504, y: 923 },
    { x: 109, y: 922 },
    { x: 256, y: 630 },
    { x: 252, y: 608 },
    { x: 238, y: 605 },
    { x: 236, y: 645 },
    { x: 224, y: 617 },
    { x: 218, y: 665 },
    { x: 217, y: 622 },
    { x: 229, y: 605 },
    { x: 208, y: 586 },
    { x: 206, y: 550 },
    { x: 153, y: 496 },
    { x: 112, y: 427 },
    { x: 77, y: 303 },
    { x: 78, y: 232 },
    { x: 105, y: 172 },
    { x: 133, y: 140 },
    { x: 177, y: 112 },
    { x: 239, y: 96 },
];
