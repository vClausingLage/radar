import Phaser from "phaser";
import Game from "./game";
import { DishRadarStation } from "../entities/dishRadarStation";
import { PlayerShip, Target } from "../entities/ship";
import { Track } from "../radar/data/track";
import { AudioPlayer } from "../audio/audioPlayer";
import { ContactCall, ContactIdentity, SupportRadarComms } from "../audio/supportRadarComms";
import { gasCloudSettings } from "../radar/data/radarGameSettings";
import { VID_RANGE_PX } from "../settings";
import { Vector2 } from "../types";

// ── Scenario geometry (one-off placements, so they live with the scene) ─────

// The gas band: a wall of absorbing gas from the south-west corner up to the
// middle of the northern edge, fully formed before the crew even starts the
// ship. It splits the world into a friendly east and a shadowed west.
const GAS_FROM: Vector2 = { x: 0, y: 2000 };
const GAS_TO: Vector2 = { x: 1250, y: 0 };

// Hostile pickets hold station in the gas shadow, strung out along the band
// like a real picket line. Where along it is random every run, but they are
// always at least this far behind the capsule's edge: the dish's energy has
// to cross the whole band twice to echo off them, which the budget does not
// cover, so Disco has no picture there — that is what makes it a no-go zone
// rather than just a hazard. Each faces the band, so its search cone covers
// the approach through the gas. The AI has no friend-or-foe logic — any track
// is a target — so the line is laid out so no picket sits inside a
// neighbour's cone: spaced along the band, in a thin depth band, with the
// heading jitter kept short of the cone edge.
const PICKET_COUNT = 3;
const PICKET_MIN_DEPTH_PX = gasCloudSettings.RADIUS + 200;
const PICKET_DEPTH_BAND_PX = 100;
const PICKET_SPACING_PX = 260;
const PICKET_HEADING_JITTER_DEG = 25;
// A neighbour closer than this to a picket's boresight would be inside its
// RWS cone (half-width 30°) once the jitter is added; the jitter is flipped
// away from it instead.
const PICKET_CONE_CLEAR_DEG = 40;
const PICKET_WORLD_MARGIN_PX = 150;
const PICKET_PLACEMENT_ATTEMPTS = 500;

// Inbound traffic: cargo ships flying the lane down the east side of the gas
// to the pad. They start staggered along the lane so they arrive one after
// another, and land beside the player's parking spot, not on it.
const TRAFFIC_ROUTE: Vector2[] = [
    { x: 1900, y: 1500 },
    { x: 1900, y: 2100 },
    { x: 1450, y: 2350 },
];
const TRAFFIC_STARTS: Vector2[] = [
    { x: 1900, y: 1050 },
    { x: 1900, y: 500 },
    { x: 1900, y: 80 },
];
const TRAFFIC_SPEED = 0.15;
const LANDING_MS = 1500;

// A picket has found the player when one of its tracks sits on the player's
// hull. Tracks are built from hits on the hull surface, so this margin only
// has to absorb the tracking computer's own scatter — a jammer's false track
// is displaced by at least JAMMER_DISTANCE_ERROR_MIN_PX and stays outside it.
const DETECTION_MARGIN_PX = 30;

// A datalink track this close to an identified ship is that ship.
const IDENTITY_MATCH_PX = 120;

// Campaign — Level 1. The ship sits powered down on the launchpad; the player
// brings it to life with the cold-start procedure (BAT, ENG1, ENG2, SYS) before
// flight controls are handed over. Once airborne, the tasking: friendly cargo
// traffic is inbound from the north to this pad, and the player has to
// identify each one visually — radar cannot tell a friendly cargo ship's
// return from anyone else's. A friendly early-warning dish radar on an
// asteroid, call sign "Disco" (player call sign: "Flatspin 1-1"), sweeps 360°
// out to long range and datalinks its contacts to the player in cyan, passes
// each new contact over the radio as it forms, and answers C ("bogey dope")
// with the nearest contact's BRAA picture and a speed order.
//
// West of the gas band is the no-go zone: Disco cannot see through the gas,
// and hostile pickets are holding in its shadow. The mission fails if a picket
// gets a track on the player, or if the player shoots down the traffic.
export default class Level1 extends Game {
    private station?: DishRadarStation;
    private comms?: SupportRadarComms;
    // Transient HUD line echoing the last comms exchange (the visual half of the
    // datalink callout), pinned to the camera.
    private commsHud?: Phaser.GameObjects.Text;
    // Standing tasking line: traffic identified so far.
    private missionHud?: Phaser.GameObjects.Text;

    // ── Mission state ──
    private traffic: Target[] = [];
    private pickets: Target[] = [];
    // Traffic ids the player has identified by eye, and those that have landed.
    private identified = new Set<number>();
    private landed = new Set<number>();
    private outcome?: 'failed' | 'complete';
    // Whether the player was behind the gas last frame, so the zone warning
    // fires on crossing in rather than every frame spent there.
    private behindGas = false;

    constructor() {
        super('Level1');
    }

    preload() {
        super.preload();
        // Ground scenery, campaign-only — the practice scenarios are set in open space.
        this.load.image('launchpad', 'launchpad.png');
        this.load.image('surface', 'surface.png');

        // GCI ("Disco") voice clips — ElevenLabs. Bogey-dope BRAA replies reuse
        // the same vocabulary as the player's own RadarVoice callouts, but as a
        // distinct speaker every shared word needs its own recording.
        const gciClips = [
            'gci-disco', 'gci-flatspin', 'gci-bra', 'gci-for',
            'gci-hot', 'gci-flanking', 'gci-beaming', 'gci-cold',
            'gci-clean', 'gci-hostile', 'gci-buster', 'gci-gate', 'gci-saunter',
            'gci-zero', 'gci-one', 'gci-two', 'gci-three', 'gci-four',
            'gci-five', 'gci-six', 'gci-seven', 'gci-eight', 'gci-nine',
            'gci-100', 'gci-200', 'gci-300', 'gci-400', 'gci-500',
            'gci-600', 'gci-700', 'gci-800', 'gci-900', 'gci-1000',
        ];
        // Player's radio voice — GPT, matching RadarVoice's existing clips.
        // ('plr-flatspin' is loaded globally by Game.preload() — the missile
        // Fox call shares it.)
        const playerClips = ['plr-disco', 'plr-bogey-dope'];
        [...gciClips, ...playerClips].forEach(key => this.load.audio(key, `audio/${key}.mp3`));
    }

    protected requiresColdStart(): boolean {
        return true;
    }

    // Ground and pad are solid bodies: the surface strip walls off the bottom
    // of the world for every radar, and both show on the ground map. The
    // ships parked on them are not shadowed by them (see Radar.nearestHit).
    // The pad is set into the ground, so the two show and hide together.
    protected buildTerrain(): void {
        const surface = this.registerTerrain(this.add.structure({ position: { x: 0, y: 2380 }, texture: 'surface' }));
        const pad = this.registerTerrain(this.add.structure({ position: { x: 1400, y: 2300 }, texture: 'launchpad', scale: 0.25 }));
        this.registerFadeGroup([surface, pad]);
    }

    protected buildScenario(): void {
        this.traffic = [];
        this.pickets = [];
        this.identified.clear();
        this.landed.clear();
        this.outcome = undefined;
        this.behindGas = false;

        this.station = new DishRadarStation(this, { x: 1600, y: 1900 });
        // Rock and dish are terrain like any other: they occlude every radar
        // in the scene — the dish's own included — and show and hide as one.
        const stationBodies = this.station.getTerrain();
        stationBodies.forEach(body => this.registerTerrain(body));
        this.registerFadeGroup(stationBodies);

        // The band is in place from the start: the zone exists before the
        // player can fly, so the briefing can point at it.
        this.gasClouds.push(this.add.gasCloud({ from: GAS_FROM, to: GAS_TO, spreadMs: 0 }));

        this.spawnPickets();
        this.spawnTraffic();
    }

    // Hostile cruisers holding station in the gas shadow. Stationary: a picket
    // is an emplacement, not a patrol. See the PICKET_* constants for the
    // layout rules.
    private spawnPickets(): void {
        const along = this.spineDirection();
        const inward = this.shadowNormal();
        const length = Phaser.Math.Distance.Between(GAS_FROM.x, GAS_FROM.y, GAS_TO.x, GAS_TO.y);

        // Stations as distances along the band, kept apart from each other and
        // inside the world once pushed back to their depth.
        const stations: { along: number; pos: Vector2 }[] = [];
        for (let attempt = 0; attempt < PICKET_PLACEMENT_ATTEMPTS && stations.length < PICKET_COUNT; attempt++) {
            const t = Phaser.Math.FloatBetween(0, length);
            if (stations.some(s => Math.abs(s.along - t) < PICKET_SPACING_PX)) continue;
            const depth = PICKET_MIN_DEPTH_PX + Phaser.Math.FloatBetween(0, PICKET_DEPTH_BAND_PX);
            const pos = {
                x: GAS_FROM.x + along.x * t + inward.x * depth,
                y: GAS_FROM.y + along.y * t + inward.y * depth,
            };
            if (pos.x < PICKET_WORLD_MARGIN_PX || pos.y < PICKET_WORLD_MARGIN_PX
                || pos.x > this.world.width - PICKET_WORLD_MARGIN_PX
                || pos.y > this.world.height - PICKET_WORLD_MARGIN_PX) continue;
            stations.push({ along: t, pos });
        }

        // Boresight straight at the band, plus a jitter that is flipped away
        // from any neighbour it would otherwise bring inside the cone.
        const towardGas = Phaser.Math.RadToDeg(Math.atan2(-inward.y, -inward.x));
        for (const station of stations) {
            let jitter = Phaser.Math.Between(-PICKET_HEADING_JITTER_DEG, PICKET_HEADING_JITTER_DEG);
            for (const other of stations) {
                if (other === station) continue;
                const bearing = Phaser.Math.RadToDeg(
                    Math.atan2(other.pos.y - station.pos.y, other.pos.x - station.pos.x),
                );
                const off = Phaser.Math.Angle.WrapDegrees(bearing - (towardGas + jitter));
                if (Math.abs(off) < PICKET_CONE_CLEAR_DEG) jitter = -jitter;
            }
            const picket = this.add.target({
                x: station.pos.x,
                y: station.pos.y,
                direction: towardGas + jitter,
                speed: 0,
                type: 'cruiser',
                activity: 'inactive',
            });
            this.pickets.push(picket);
            this.targets.push(picket);
        }
    }

    // Friendly cargo inbound down the lane east of the gas, staggered so they
    // reach the pad one at a time. Cargo never attacks — it flies its route and
    // defends itself if locked — so the only thing that distinguishes it from
    // the pickets is the side it is on, which no sensor in the game can read.
    private spawnTraffic(): void {
        for (const start of TRAFFIC_STARTS) {
            const cargo = this.add.target({
                x: start.x,
                y: start.y,
                direction: 90,
                speed: TRAFFIC_SPEED,
                type: 'cargo',
                side: 'friendly',
                route: TRAFFIC_ROUTE,
            });
            this.traffic.push(cargo);
            this.targets.push(cargo);
        }
    }

    create() {
        super.create();

        // On-demand comms: no cooldown, so each C press is answered immediately;
        // the unprompted contact calls throttle themselves.
        this.comms = new SupportRadarComms(new AudioPlayer(this, 0));

        this.commsHud = this.add.text(this.scale.width / 2, 120, '', {
            font: '20px Courier',
            color: '#00aeef',
            backgroundColor: '#000000aa',
            padding: { x: 12, y: 6 },
        }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(1000).setVisible(false);

        this.missionHud = this.add.text(16, 16, '', {
            font: '16px Courier',
            color: '#00aeef',
            backgroundColor: '#000000aa',
            padding: { x: 10, y: 5 },
        }).setOrigin(0, 0).setScrollFactor(0).setDepth(1000);
        this.updateMissionHud();

        this.input.keyboard?.on('keydown-C', this.onRequestBogeyDope);
        this.events.once('shutdown', () => {
            this.input.keyboard?.off('keydown-C', this.onRequestBogeyDope);
        });
    }

    protected briefingMessage(): string {
        return 'LEVEL 1 — Cold ship on the pad: run BAT, ENG1, ENG2, SYS. Tasking: friendly cargo traffic is inbound from the north to this pad. Radar cannot tell friend from bogey — close to visual range and identify each one. Disco (cyan datalink) calls new contacts and answers C with a bogey dope. The gas band to the west is a no-go line: Disco has no picture behind it and hostile pickets hold there. If a picket tracks you, or you shoot the traffic, the mission is over.';
    }

    // ── Comms ──

    // Key a "bogey dope" call: the player transmits the request (GPT voice) and
    // Disco replies with the nearest datalink contact's BRAA picture and a speed
    // order (ElevenLabs voice), or "clean" if there's nothing on the scope. Echo
    // the same picture on the HUD so it reaches the player by voice and sight.
    private onRequestBogeyDope = () => {
        if (!this.player || !this.station || !this.comms) return;
        // EMCON forbids any active transmission, including keying the radio —
        // the request never goes out, so Disco never answers.
        if (this.player.radar.getMode() === 'emcon') {
            this.showCommsHud('EMCON — TRANSMISSION HELD');
            return;
        }
        const call = this.comms.requestBogeyDope(this.player, this.station.getTracks(), this.identifyContact);
        this.showCommsHud(call ? `DISCO — ${this.describeCall(call)}` : 'DISCO — PICTURE CLEAN');
    };

    // Disco's own declaration of a datalink track. The dish sees geometry
    // only; the identity comes from what the player has already put eyes on.
    private identifyContact = (track: Track): ContactIdentity => {
        const seen = this.traffic.some(ship =>
            ship.active && ship.body && this.identified.has(ship.id)
            && Phaser.Math.Distance.Between(ship.x, ship.y, track.pos.x, track.pos.y) < IDENTITY_MATCH_PX,
        );
        return seen ? 'friendly' : 'bogey';
    };

    private describeCall(call: ContactCall): string {
        return `BRA ${String(call.bearing).padStart(3, '0')} FOR ${Math.round(call.rangePx)}, `
            + `${call.aspect.toUpperCase()}, ${call.identity.toUpperCase()} — ${call.speedOrder.toUpperCase()}`;
    }

    private showCommsHud(text: string): void {
        if (!this.commsHud) return;
        this.tweens.killTweensOf(this.commsHud);
        this.commsHud.setText(text).setVisible(true).setAlpha(1);
        this.tweens.add({
            targets: this.commsHud,
            alpha: 0,
            delay: 3500,
            duration: 800,
            onComplete: () => this.commsHud?.setVisible(false),
        });
    }

    private updateMissionHud(): void {
        this.missionHud?.setText(
            `TASKING — VID INBOUND TRAFFIC ${this.identified.size}/${this.traffic.length}   NO-GO WEST OF THE GAS`,
        );
    }

    // ── Per-frame ──

    update(time: number, delta: number): void {
        super.update(time, delta);

        // Base update bailed (player gone / graphics torn down): don't draw.
        const player = this.player;
        if (!player || !this.graphics) return;

        // Sweep the dish and paint the shared picture. It detects the targets
        // (not the friendly player) and is occluded by the same terrain list,
        // its own rock included. The dish shoots through the same gas the
        // player does.
        this.station?.update(
            delta, this.targets, this.terrain, this.graphics,
            this.gasClouds.map(cloud => cloud.getVolume()),
        );

        this.drawIdentified(this.graphics);
        // Arrivals land whatever the mission state. The verdict takes the
        // player's controls, not the world's clock — the ship identified on
        // final approach (the one that completes the tasking) still has to set
        // down and go, or it sits on the pad forever.
        this.landArrivedTraffic();
        if (this.outcome) return;

        // Disco passes each new contact as its track matures. Not while the
        // ship is still cold on the pad — the radio is not powered yet. EMCON
        // does not stop these: it silences our transmitter, not our receiver.
        if (this.station && this.comms && this.isReadyForFlight()) {
            const call = this.comms.announceNewContact(
                player, this.station.getTracks(), this.identifyContact, this.time.now,
            );
            if (call) this.showCommsHud(`DISCO — NEW CONTACT, ${this.describeCall(call)}`);
        }

        this.updateTraffic(player);
        this.watchNoGoZone(player);
    }

    // Visual identification: a cargo ship inside VID range is identified; one
    // that is gone without having landed was shot down.
    private updateTraffic(player: PlayerShip): void {
        for (const ship of this.traffic) {
            if (!ship.active || !ship.body) {
                if (!this.landed.has(ship.id)) {
                    this.failMission('FRIENDLY TRAFFIC DESTROYED');
                    return;
                }
                continue;
            }

            if (!this.identified.has(ship.id)
                && Phaser.Math.Distance.Between(player.x, player.y, ship.x, ship.y) <= VID_RANGE_PX) {
                this.identified.add(ship.id);
                this.updateMissionHud();
                this.showCommsHud(`FLATSPIN 1-1 — VISUAL, FRIENDLY CARGO (${this.identified.size}/${this.traffic.length})`);
                if (this.identified.size === this.traffic.length) {
                    this.outcome = 'complete';
                    this.showOutcome('MISSION COMPLETE — ALL INBOUND TRAFFIC IDENTIFIED', '#00ff00');
                }
            }
        }
    }

    // A cargo ship that has reached the pad drops onto it and is gone.
    private landArrivedTraffic(): void {
        for (const ship of this.traffic) {
            if (!ship.active || !ship.body || this.landed.has(ship.id)) continue;
            if (ship.controller?.hasArrived()) {
                this.landed.add(ship.id);
                this.landTraffic(ship);
            }
        }
    }

    // Set the cargo down on the pad: it shrinks away as it descends, then the
    // entity goes — a landed ship is no longer a contact for anyone's radar.
    private landTraffic(ship: Target): void {
        ship.controller?.destroy();
        this.tweens.add({
            targets: ship,
            // Not all the way to zero: the Matter body scales with the sprite,
            // and a zero-size body is degenerate geometry for the raycaster.
            scale: 0.05,
            duration: LANDING_MS,
            onComplete: () => {
                if (ship.active) ship.destroy();
            },
        });
    }

    // The no-go zone. Crossing the band draws a warning from Disco; being
    // tracked by a picket in its shadow ends the mission — not being seen is
    // the whole task, and the RWR's search warning is the cue to turn back
    // before that happens (an emitter is heard long before it gets an echo).
    private watchNoGoZone(player: PlayerShip): void {
        const behind = this.isBehindGas({ x: player.x, y: player.y });
        if (behind && !this.behindGas) {
            this.showCommsHud('DISCO — FLATSPIN, YOU ARE BEHIND THE GAS. NO PICTURE THERE — COME EAST');
        }
        this.behindGas = behind;

        const hull = Math.max(player.displayWidth, player.displayHeight) / 2 + DETECTION_MARGIN_PX;
        const hullSq = hull * hull;
        for (const picket of this.pickets) {
            if (!picket.active || !picket.body) continue;
            const seen = picket.radar.getTracks().some(track =>
                Phaser.Math.Distance.Squared(track.pos.x, track.pos.y, player.x, player.y) <= hullSq,
            );
            if (seen) {
                this.failMission('DETECTED BY A HOSTILE PICKET BEHIND THE GAS');
                return;
            }
        }
    }

    private failMission(reason: string): void {
        if (this.outcome) return;
        this.outcome = 'failed';
        // Take the controls away: the verdict is in, the ship holds where it is.
        const player = this.player;
        if (player) {
            player.controller?.destroy();
            player.controller = undefined;
            player.setCurrentSpeed(0);
        }
        this.showOutcome(`MISSION FAILED — ${reason}`, '#ff0000');
    }

    // Mark identified traffic on the tactical picture: a ring in datalink cyan
    // around the hull, the one contact on the scope whose identity is known.
    private drawIdentified(graphics: Phaser.GameObjects.Graphics): void {
        graphics.lineStyle(1, 0x00aeef, 0.8);
        for (const ship of this.traffic) {
            if (!ship.active || !ship.body || !this.identified.has(ship.id)) continue;
            graphics.strokeCircle(ship.x, ship.y, Math.max(ship.displayWidth, ship.displayHeight) / 2 + 10);
        }
    }

    // ── Gas band geometry ──
    // The band runs the full height of the world, so "behind" is simply the
    // side of its spine line the pad is not on.

    private sideOfSpine(pos: Vector2): number {
        const sx = GAS_TO.x - GAS_FROM.x;
        const sy = GAS_TO.y - GAS_FROM.y;
        return sx * (pos.y - GAS_FROM.y) - sy * (pos.x - GAS_FROM.x);
    }

    private isBehindGas(pos: Vector2): boolean {
        const padSide = Math.sign(this.sideOfSpine(TRAFFIC_ROUTE[TRAFFIC_ROUTE.length - 1]));
        return Math.sign(this.sideOfSpine(pos)) === -padSide;
    }

    // Unit vector along the spine, from its start to its end.
    private spineDirection(): Vector2 {
        const length = Phaser.Math.Distance.Between(GAS_FROM.x, GAS_FROM.y, GAS_TO.x, GAS_TO.y);
        return { x: (GAS_TO.x - GAS_FROM.x) / length, y: (GAS_TO.y - GAS_FROM.y) / length };
    }

    // Unit normal to the spine pointing into the shadow, away from the pad.
    private shadowNormal(): Vector2 {
        const along = this.spineDirection();
        const normal = { x: -along.y, y: along.x };
        const probe = { x: GAS_FROM.x + normal.x, y: GAS_FROM.y + normal.y };
        return this.isBehindGas(probe) ? normal : { x: -normal.x, y: -normal.y };
    }

    protected onPlayerLanded(): void {
        super.onPlayerLanded();
        // Not for the cold ship on the pad at the start: its first contact is
        // the physics engine noticing where it was parked.
        if (this.isReadyForFlight()) this.showCommsHud('FLATSPIN 1-1 — TOUCHDOWN');
    }

    protected destroyPlayer(): void {
        super.destroyPlayer();
        this.station?.destroy();
        this.station = undefined;
    }
}
