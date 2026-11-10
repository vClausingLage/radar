import Phaser from 'phaser';

// The start menu's picture: the bridge of an old ship, an alien hunched over the
// one live scope, a gas giant and a freighter outside. Runs as its own scene
// under StartMenu, so the menu's zoomed design sheet and this pixel-art sheet
// each keep their own camera.
//
// The art is one 640x270 pixel sheet (public/menu/bridge.png, its window cut out
// to transparency) with the moving parts layered behind and in front of it.
// Coordinates below are art pixels on that sheet.
//
// The scope is drawn, not painted: it is a real PPI. The sweep turns, and the
// freighter's paint lands at the bearing and range the freighter actually has
// from the console, then fades with the phosphor until the beam comes round
// again. Nothing here touches a Radar: it is scenery, like the Starfield.

const SHEET_W = 640;
const SHEET_H = 270;

// Everything left of this column on the sheet is black wall: the menu lives there.
const SHEET_MENU_EDGE_X = 235;

// Rows faded to black at the top and bottom, where a letterboxed sheet meets the
// black of the canvas.
const EDGE_FADE_ROWS = 14;

// The window's opening (stars are scattered inside it; the bridge masks the rest).
const WINDOW = { left: 286, right: 587, top: 34, bottom: 171 };

// The scope on the console: centre and radius of its glass, in art px.
const SCOPE = { x: 427.5, y: 159, r: 7 };
// One full turn of the sweep, ms.
const SWEEP_PERIOD_MS = 3200;
// How many trailing lines the sweep drags behind it, and how far back they reach (deg).
const SWEEP_TRAIL_LINES = 8;
const SWEEP_TRAIL_DEG = 40;

const PLANET = { x: 262, y: 92 };
// The planet sways this far (px) on a slow cycle (ms): the ship rides a long orbit.
const PLANET_DRIFT_PX = 3;
const PLANET_DRIFT_PERIOD_MS = 47000;

// The freighter crosses the planet's face and back on this cycle; the scope's
// paint follows it.
const SHIP = { x: 318, y: 128 };
const SHIP_DRIFT_PX = 14;
const SHIP_DRIFT_PERIOD_MS = 61000;

// Where the alien stands: bottom-left of its frame, back to us at the console,
// placed so its fingertips rest just right of the scope.
const ALIEN_FOOT = { x: 433, y: 224 };
// 24 frames (8 key poses, in-betweened by Sprixen) at 10 fps: one calm 2.4 s loop.
const ALIEN_FPS = 10;
// Frame size of public/menu/alien.png, the Sprixen idle loop laid out in one row,
// halved from Sprixen's 256 px frames to the sheet's pixel size.
const ALIEN_FRAME = { w: 76, h: 112 };
// The sprite is lit brighter than the room it stands in; this brings it down.
const ALIEN_TINT = 0x828282;
const PLANET_TINT = 0xc4c4c4;

// The room is unlit: the scope is the only lamp. A sheet of darkness lies over
// the bridge (never over the window), opened only in a pool around the scope.
const ROOM_DARKNESS = 0.68;
// Radius (art px) of the pool the scope lights, and how far into it the dark
// lifts at the very centre (1 = fully lit).
const SCOPE_LIGHT_RADIUS_PX = 78;
const SCOPE_LIGHT_STRENGTH = 0.8;

const STAR_COUNT = 46;
// The scope's light: a dip in the tube's brightness every few seconds.
const FLICKER_GAP_MS = { min: 1800, max: 5200 };
const FLICKER_DIP_MS = 90;

// Fixed seed: the menu must not draw Math.random (see DEFAULT_TEST_SEED).
const BACKDROP_SEED = 'radar-bridge';

const TEX = {
    bridge: 'menu-bridge',
    planet: 'menu-planet',
    freighter: 'menu-freighter',
    alien: 'menu-alien',
    glow: 'menu-scope-glow',
};
const ALIEN_ANIM = 'menu-alien-idle';

interface Star {
    x: number;
    y: number;
    color: number;
    brightness: number;
    phase: number;
    speed: number;
}

export interface BackdropLayout {
    zoom: number;
    // Camera centre on the sheet.
    centerX: number;
    centerY: number;
    // Width (screen px) of the black column on the left that the menu may use.
    menuColumnPx: number;
}

export default class MenuBackdrop extends Phaser.Scene {
    private rng = new Phaser.Math.RandomDataGenerator([BACKDROP_SEED]);
    private stars: Star[] = [];
    private starGfx!: Phaser.GameObjects.Graphics;
    private scopeGfx!: Phaser.GameObjects.Graphics;
    private planet!: Phaser.GameObjects.Image;
    private ship!: Phaser.GameObjects.Image;
    private glow!: Phaser.GameObjects.Image;
    // A star that glints (a short cross of light), and when it ends.
    private glint?: { star: Star; until: number };
    private nextGlintAt = 0;
    private flickerUntil = 0;
    private nextFlickerAt = 0;
    // Brightness of the freighter's paint on the scope: 1 when the beam crosses it.
    private paint = 0;
    private lastSweepDeg = 0;

    constructor() {
        super('MenuBackdrop');
    }

    // The sheet is fitted whole (contain), pinned to the right edge and centred
    // vertically, so the bridge is never cropped and the dark left side widens
    // with the window. Static so the menu can place itself from the same numbers.
    static layout(width: number, height: number): BackdropLayout {
        const zoom = Math.min(width / SHEET_W, height / SHEET_H);
        const viewW = width / zoom;
        const viewLeft = SHEET_W - viewW;
        return {
            zoom,
            centerX: SHEET_W - viewW / 2,
            centerY: SHEET_H / 2,
            menuColumnPx: (SHEET_MENU_EDGE_X - viewLeft) * zoom,
        };
    }

    preload(): void {
        this.load.image(TEX.bridge, 'menu/bridge.png');
        this.load.image(TEX.planet, 'menu/planet.png');
        // The game's own freighter (cargo.png) cut down to a 26 px black silhouette.
        this.load.image(TEX.freighter, 'menu/freighter.png');
        this.load.spritesheet(TEX.alien, 'menu/alien.png', { frameWidth: ALIEN_FRAME.w, frameHeight: ALIEN_FRAME.h });
    }

    create(): void {
        // Pixel art: no smoothing when the sheet is zoomed up.
        [TEX.bridge, TEX.planet, TEX.freighter, TEX.alien].forEach(key => this.textures.get(key).setFilter(Phaser.Textures.FilterMode.NEAREST));
        this.cameras.main.setBackgroundColor(0x000000);
        this.rng = new Phaser.Math.RandomDataGenerator([BACKDROP_SEED]);
        this.glint = undefined;

        this.stars = this.makeStars();
        this.starGfx = this.add.graphics();
        this.planet = this.add.image(PLANET.x, PLANET.y, TEX.planet).setOrigin(0).setTint(PLANET_TINT);
        // The freighter is a black cut-out against the planet: no light falls on it.
        this.ship = this.add.image(SHIP.x, SHIP.y, TEX.freighter).setOrigin(0.5);
        this.add.image(0, 0, TEX.bridge).setOrigin(0);
        this.add.image(0, 0, this.ensureDarknessTexture()).setOrigin(0);
        this.glow =this.add.image(SCOPE.x, SCOPE.y, this.ensureGlowTexture())
            .setBlendMode(Phaser.BlendModes.ADD);
        this.scopeGfx = this.add.graphics();
        this.addAlien();
        this.addEdgeFades();

        this.fitToWindow();
        const onResize = () => this.fitToWindow();
        this.scale.on(Phaser.Scale.Events.RESIZE, onResize);
        this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off(Phaser.Scale.Events.RESIZE, onResize));
    }

    update(time: number, delta: number): void {
        this.planet.setPosition(
            PLANET.x + Math.round(Math.sin(time / PLANET_DRIFT_PERIOD_MS * Math.PI * 2) * PLANET_DRIFT_PX),
            PLANET.y,
        );
        this.ship.setPosition(
            SHIP.x + Math.round(Math.sin(time / SHIP_DRIFT_PERIOD_MS * Math.PI * 2) * SHIP_DRIFT_PX),
            SHIP.y + Math.round(Math.sin(time / 9000) * 1),
        );
        this.drawStars(time);
        this.drawScope(time, delta);
    }

    private fitToWindow(): void {
        const layout = MenuBackdrop.layout(this.scale.width, this.scale.height);
        this.cameras.main.setZoom(layout.zoom).centerOn(layout.centerX, layout.centerY);
    }

    // ── Sky ───────────────────────────────────────────────────────────────

    private makeStars(): Star[] {
        const colors = [0x96aad2, 0xc8d7f0, 0x6e78a0, 0xe6ecff];
        return Array.from({ length: STAR_COUNT }, () => ({
            x: this.rng.between(WINDOW.left, WINDOW.right),
            y: this.rng.between(WINDOW.top, WINDOW.bottom),
            color: this.rng.pick(colors),
            brightness: this.rng.realInRange(0.35, 1),
            phase: this.rng.realInRange(0, Math.PI * 2),
            speed: this.rng.realInRange(0.0006, 0.0025),
        }));
    }

    private drawStars(time: number): void {
        const g = this.starGfx.clear();
        if (time >= this.nextGlintAt) {
            this.glint = { star: this.rng.pick(this.stars), until: time + 520 };
            this.nextGlintAt = time + this.rng.between(1400, 4200);
        }
        for (const s of this.stars) {
            const alpha = s.brightness * (0.55 + 0.45 * Math.sin(time * s.speed + s.phase));
            g.fillStyle(s.color, alpha).fillRect(s.x, s.y, 1, 1);
        }
        // The glint: a one-pixel cross that swells and fades, like the sketch's stars.
        if (this.glint && time < this.glint.until) {
            const { star } = this.glint;
            const k = Math.sin((1 - (this.glint.until - time) / 520) * Math.PI);
            g.fillStyle(0xeef3ff, k).fillRect(star.x, star.y, 1, 1);
            g.fillStyle(0xb4c8f0, k * 0.7)
                .fillRect(star.x - 1, star.y, 1, 1).fillRect(star.x + 1, star.y, 1, 1)
                .fillRect(star.x, star.y - 1, 1, 1).fillRect(star.x, star.y + 1, 1, 1);
            if (k > 0.6) {
                g.fillStyle(0x8ca0d2, (k - 0.6) * 1.5)
                    .fillRect(star.x - 2, star.y, 1, 1).fillRect(star.x + 2, star.y, 1, 1)
                    .fillRect(star.x, star.y - 2, 1, 1).fillRect(star.x, star.y + 2, 1, 1);
            }
        }
    }

    // ── Scope ─────────────────────────────────────────────────────────────

    private drawScope(time: number, delta: number): void {
        // Tube brightness: steady with a slight shimmer, and now and then a dip
        // when the old supply sags.
        if (time >= this.nextFlickerAt) {
            this.flickerUntil = time + FLICKER_DIP_MS;
            this.nextFlickerAt = time + this.rng.between(FLICKER_GAP_MS.min, FLICKER_GAP_MS.max);
        }
        const dipping = time < this.flickerUntil;
        const tube = (dipping ? 0.45 : 0.9) + this.rng.realInRange(-0.06, 0.06);
        this.glow.setAlpha(tube * 0.55);

        // A PPI with north up: 0 deg at the top, turning clockwise.
        const sweepDeg = (time / SWEEP_PERIOD_MS * 360) % 360;
        const contact = this.contactOnScope();
        // The beam paints the contact as it passes its bearing; the phosphor then
        // fades over one turn, which is why a real PPI shows a blip, not a dot.
        if (Phaser.Math.Angle.WrapDegrees(sweepDeg - contact.bearingDeg) >= 0
            && Phaser.Math.Angle.WrapDegrees(this.lastSweepDeg - contact.bearingDeg) < 0) {
            this.paint = 1;
        } else {
            this.paint = Math.max(0, this.paint - delta / SWEEP_PERIOD_MS);
        }
        this.lastSweepDeg = sweepDeg;

        const g = this.scopeGfx.clear();
        g.fillStyle(0x021306, 1).fillCircle(SCOPE.x, SCOPE.y, SCOPE.r + 0.5);
        g.lineStyle(0.5, 0x1f8a3a, 0.5 * tube).strokeCircle(SCOPE.x, SCOPE.y, SCOPE.r * 0.55);
        for (let i = SWEEP_TRAIL_LINES; i >= 0; i--) {
            const deg = sweepDeg - (i / SWEEP_TRAIL_LINES) * SWEEP_TRAIL_DEG;
            const end = this.scopePoint(deg, SCOPE.r);
            const alpha = (i === 0 ? 1 : 0.35 * (1 - i / SWEEP_TRAIL_LINES)) * tube;
            g.lineStyle(i === 0 ? 0.8 : 0.6, 0x4dff7a, alpha).lineBetween(SCOPE.x, SCOPE.y, end.x, end.y);
        }
        if (this.paint > 0.02) {
            const blip = this.scopePoint(contact.bearingDeg, contact.rangeFrac * SCOPE.r);
            g.fillStyle(0xb8ffc8, this.paint * tube).fillRect(blip.x - 0.5, blip.y - 0.5, 1, 1);
        }
        g.lineStyle(0.6, 0x2fbf55, 0.8 * tube).strokeCircle(SCOPE.x, SCOPE.y, SCOPE.r);
    }

    // The freighter as the console sees it: its true bearing from the scope (on
    // the sheet, up is "ahead"), and its range scaled into the scope's ring.
    private contactOnScope(): { bearingDeg: number; rangeFrac: number } {
        const dx = this.ship.x - SCOPE.x;
        const dy = this.ship.y - SCOPE.y;
        const bearingDeg = Phaser.Math.RadToDeg(Math.atan2(dx, -dy));
        const rangeFrac = Phaser.Math.Clamp(Math.hypot(dx, dy) / 160, 0.25, 0.9);
        return { bearingDeg, rangeFrac };
    }

    private scopePoint(deg: number, radius: number): { x: number; y: number } {
        const rad = Phaser.Math.DegToRad(deg);
        return { x: SCOPE.x + Math.sin(rad) * radius, y: SCOPE.y - Math.cos(rad) * radius };
    }

    // ── Room ──────────────────────────────────────────────────────────────

    private addAlien(): void {
        if (!this.anims.exists(ALIEN_ANIM)) {
            this.anims.create({
                key: ALIEN_ANIM,
                frames: this.anims.generateFrameNumbers(TEX.alien),
                frameRate: ALIEN_FPS,
                repeat: -1,
            });
        }
        this.add.sprite(ALIEN_FOOT.x, ALIEN_FOOT.y, TEX.alien)
            .setOrigin(0, 1)
            .setTint(ALIEN_TINT)
            .play(ALIEN_ANIM);
    }

    // The scope's green light on the room, a soft disc added over the bridge.
    private ensureGlowTexture(): string {
        if (this.textures.exists(TEX.glow)) return TEX.glow;
        const size = 72;
        const tex = this.textures.createCanvas(TEX.glow, size, size);
        if (!tex) return TEX.glow;
        const ctx = tex.getContext();
        const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
        grad.addColorStop(0, 'rgba(70, 255, 110, 0.55)');
        grad.addColorStop(0.35, 'rgba(40, 200, 80, 0.22)');
        grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, size, size);
        tex.refresh();
        return TEX.glow;
    }

    // The room's darkness: black over every opaque pixel of the bridge, lifted
    // in a soft pool around the scope. The window is the bridge's transparent
    // hole, so space, the planet and the stars stay as bright as they are.
    private ensureDarknessTexture(): string {
        const key = 'menu-room-darkness';
        if (this.textures.exists(key)) return key;
        const tex = this.textures.createCanvas(key, SHEET_W, SHEET_H);
        if (!tex) return key;
        const ctx = tex.getContext();
        ctx.fillStyle = `rgba(0, 0, 0, ${ROOM_DARKNESS})`;
        ctx.fillRect(0, 0, SHEET_W, SHEET_H);

        ctx.globalCompositeOperation = 'destination-out';
        const pool = ctx.createRadialGradient(SCOPE.x, SCOPE.y, 0, SCOPE.x, SCOPE.y, SCOPE_LIGHT_RADIUS_PX);
        pool.addColorStop(0, `rgba(0, 0, 0, ${SCOPE_LIGHT_STRENGTH})`);
        pool.addColorStop(0.3, `rgba(0, 0, 0, ${SCOPE_LIGHT_STRENGTH * 0.5})`);
        pool.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = pool;
        ctx.fillRect(0, 0, SHEET_W, SHEET_H);

        ctx.globalCompositeOperation = 'destination-in';
        ctx.drawImage(this.textures.get(TEX.bridge).getSourceImage() as HTMLImageElement, 0, 0);
        ctx.globalCompositeOperation = 'source-over';
        tex.refresh();
        // Nearest, like the bridge, or the zoomed-up edge would bleed into the window.
        tex.setFilter(Phaser.Textures.FilterMode.NEAREST);
        return key;
    }

    // Top and bottom rows fade to black, so a letterboxed sheet has no hard edge.
    private addEdgeFades(): void {
        const g = this.add.graphics();
        for (let i = 0; i < EDGE_FADE_ROWS; i++) {
            const alpha = 1 - i / EDGE_FADE_ROWS;
            g.fillStyle(0x000000, alpha)
                .fillRect(0, i, SHEET_W, 1)
                .fillRect(0, SHEET_H - 1 - i, SHEET_W, 1);
        }
    }
}
