import Phaser from "phaser";
import Game from "./game";
import { DishRadarStation } from "../entities/dishRadarStation";
import { PlayerShip, Target } from "../entities/ship";
import { Track } from "../radar/data/track";
import { AudioPlayer } from "../audio/audioPlayer";
import { ContactCall, ContactIdentity, SupportRadarComms } from "../audio/supportRadarComms";
import { RadioLineKey, RadioNet, RadioTransmission } from "../audio/radioNet";
import { gasCloudSettings } from "../radar/data/radarGameSettings";
import { playerShipSettings, VID_RANGE_PX } from "../settings";
import { Vector2 } from "../types";

// ── The theatre every campaign level is fought in ───────────────────────────
// (one-off placements, so they live with the scenes rather than in settings)

// The gas band: a wall of absorbing gas from the south-west corner up to the
// middle of the northern edge, fully formed before the crew even starts the
// ship. It splits the world into a friendly east and a shadowed north-west.
export const GAS_FROM: Vector2 = { x: 0, y: 2000 };
export const GAS_TO: Vector2 = { x: 1250, y: 0 };

// The pad, and the dish rock "Disco" stands on. The rock sits well north of
// the pad so the dish covers deep into the approaches and there is open
// space to work in between the two.
export const PAD_POSITION: Vector2 = { x: 1400, y: 2300 };
export const STATION_POSITION: Vector2 = { x: 1600, y: 1500 };

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

// Raiders come through the band rather than round it: they start inside the
// gas, where neither the dish nor anyone else can hold them, and pop up on
// the scopes as they leave the far edge. Their ingress route first pushes
// straight out of the band, then heads for the target.
const RAIDER_SPEED = 0.12;
const RAIDER_EXIT_PX = gasCloudSettings.RADIUS + 200;

// A picket has found the player when one of its tracks sits on the player's
// hull. Tracks are built from hits on the hull surface, so this margin only
// has to absorb the tracking computer's own scatter — a jammer's false track
// is displaced by at least JAMMER_DISTANCE_ERROR_MIN_PX and stays outside it.
const DETECTION_MARGIN_PX = 30;

// A datalink track this close to a ship is that ship.
const IDENTITY_MATCH_PX = 120;

// Landing traffic shrinks away onto the pad over this long.
const LANDING_MS = 1500;
// ...or glides across to its spot on the pad first, when towed in.
const LANDING_GLIDE_MS = 4000;

// Scripted radio traffic starts a beat after the scene opens, once the
// briefing card is up.
const OPENING_RADIO_DELAY_MS = 1500;
// The ship counts as airborne once it has moved this far off its parking spot.
const AIRBORNE_DISTANCE_PX = 40;

// Radio subtitles sit along the top edge of the screen, above the tasking
// line — the bottom belongs to the RWR and the cold-start switches.
const RADIO_HUD_TOP_MARGIN_PX = 12;
const RADIO_HUD_WIDTH_PX = 760;

// A campaign level: the shared theatre — surface and pad, the friendly dish
// radar "Disco" (player call sign: "Flatspin 1-1"), the gas band and whatever
// holds in its shadow — plus the radio net that carries the story. Levels
// subclass this and fill in the mission: who is out there (buildMission), what
// is said (openingTransmissions and the event hooks) and what wins or loses
// it (updateMission).
//
// Radar gives geometry, never identity. A contact is a bogey until someone
// puts eyes on it — the player inside VID range — or Disco declares it; the
// friendly/hostile ship lists here are the scene's ground truth, which the
// radio and datalink only ever reveal through those two routes.
export default abstract class CampaignLevel extends Game {
    protected station?: DishRadarStation;
    protected comms?: SupportRadarComms;
    protected radio?: RadioNet;
    // Transient HUD line echoing the last comms exchange (the visual half of the
    // datalink callout), pinned to the camera.
    private commsHud?: Phaser.GameObjects.Text;
    // Standing tasking lines: the level and how the mission stands.
    private missionHud?: Phaser.GameObjects.Text;
    // Subtitle of whatever is on the radio net right now.
    private radioHud?: Phaser.GameObjects.Text;

    // ── Mission state ──
    protected friendlies: Target[] = [];
    protected hostiles: Target[] = [];
    protected pickets: Target[] = [];
    private callsigns = new Map<number, string>();
    // Ships identified by eye; hostiles declared (by eye or by Disco).
    protected identified = new Set<number>();
    protected declaredHostile = new Set<number>();
    // Friendlies that set down, and hostiles already reported destroyed.
    protected landed = new Set<number>();
    private splashed = new Set<number>();
    protected outcome?: 'failed' | 'complete';
    protected airborneAt?: number;
    // Whether the player was behind the gas last frame, so the zone warning
    // fires on crossing in rather than every frame spent there.
    private behindGas = false;

    // ── What a level defines ──

    // "LEVEL 1 — MULE TRAIN", for the HUD.
    protected abstract levelTitle(): string;
    // Populate the world beyond the shared theatre.
    protected abstract buildMission(): void;
    // One line on the HUD: how the tasking stands.
    protected abstract missionStatus(): string;
    // The scene the ENTER key leads to after a win; none after the last level.
    protected nextLevel(): string | undefined {
        return undefined;
    }
    // Radio traffic played while the crew runs the cold start.
    protected openingTransmissions(): RadioLineKey[] {
        return [];
    }
    // The ship has left the pad.
    protected onAirborne?(): void;
    // The player has put eyes on a friendly.
    protected onFriendlyIdentified?(ship: Target): void;
    // A friendly has set down on the pad.
    protected onFriendlyLanded?(ship: Target): void;
    // A friendly is gone without having landed.
    protected onFriendlyLost(ship: Target): void {
        this.failMission(`${this.callsignOf(ship)} DESTROYED`, 'fail-fratricide');
    }
    // A hostile is gone. Without an override the splash is simply called
    // and acknowledged.
    protected onHostileDestroyed?(ship: Target): void;
    // Per-frame mission logic, while the outcome is still open.
    protected updateMission?(player: PlayerShip, delta: number): void;

    protected requiresColdStart(): boolean {
        return true;
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

        // The story's radio traffic (tools/generateClips.js). Lines not yet
        // recorded fail to load and are shown as subtitles only.
        RadioNet.clips().forEach(({ key, path }) => this.load.audio(key, path));
    }

    // Ground and pad are solid bodies: the surface strip walls off the bottom
    // of the world for every radar, and both show on the ground map. The
    // ships parked on them are not shadowed by them (see Radar.nearestHit).
    // The pad is set into the ground, so the two show and hide together.
    protected buildTerrain(): void {
        const surface = this.registerTerrain(this.add.structure({ position: { x: 0, y: 2380 }, texture: 'surface' }));
        const pad = this.registerTerrain(this.add.structure({ position: PAD_POSITION, texture: 'launchpad', scale: 0.25 }));
        this.registerFadeGroup([surface, pad]);
    }

    protected buildScenario(): void {
        // Phaser reuses the scene instance on restart: start from nothing.
        this.friendlies = [];
        this.hostiles = [];
        this.pickets = [];
        this.callsigns.clear();
        this.identified.clear();
        this.declaredHostile.clear();
        this.landed.clear();
        this.splashed.clear();
        this.outcome = undefined;
        this.airborneAt = undefined;
        this.behindGas = false;

        this.station = new DishRadarStation(this, STATION_POSITION);
        // Rock and dish are terrain like any other: they occlude every radar
        // in the scene — the dish's own included — and show and hide as one.
        const stationBodies = this.station.getTerrain();
        stationBodies.forEach(body => this.registerTerrain(body));
        this.registerFadeGroup(stationBodies);

        // The band is in place from the start: the zone exists before the
        // player can fly, so the briefing can point at it.
        this.gasClouds.push(this.add.gasCloud({ from: GAS_FROM, to: GAS_TO, spreadMs: 0 }));

        this.buildMission();
    }

    create() {
        super.create();

        // One radio frequency, shared by the scripted traffic and Disco's
        // datalink calls so the two never talk over each other. No cooldown:
        // each C press is answered immediately; the unprompted contact calls
        // throttle themselves.
        const net = new AudioPlayer(this, 0);
        this.comms = new SupportRadarComms(net);
        this.radio = new RadioNet(this, net, transmission => this.showRadioHud(transmission));

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

        this.radioHud = this.add.text(0, 0, '', {
            font: '18px Courier',
            color: '#ffffff',
            backgroundColor: '#000000cc',
            padding: { x: 14, y: 8 },
            wordWrap: { width: Math.min(this.scale.width - 80, RADIO_HUD_WIDTH_PX) },
        }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(1001).setVisible(false);

        const opening = this.openingTransmissions();
        if (opening.length > 0) {
            this.time.delayedCall(OPENING_RADIO_DELAY_MS, () => {
                if (!this.outcome) this.radio?.say(...opening);
            });
        }

        this.input.keyboard?.on('keydown-C', this.onRequestBogeyDope);
        this.input.keyboard?.on('keydown-ENTER', this.onContinue);
        this.input.keyboard?.on('keydown-M', this.onMenu);
        this.events.once('shutdown', () => {
            this.input.keyboard?.off('keydown-C', this.onRequestBogeyDope);
            this.input.keyboard?.off('keydown-ENTER', this.onContinue);
            this.input.keyboard?.off('keydown-M', this.onMenu);
        });
    }

    // ── Spawning ──

    // A named ship: the call sign is what the HUD and the verdicts use.
    protected setCallsign(ship: Target, callsign: string): void {
        this.callsigns.set(ship.id, callsign);
    }

    protected callsignOf(ship: Target): string {
        return this.callsigns.get(ship.id) ?? (ship.side === 'friendly' ? 'FRIENDLY' : 'HOSTILE');
    }

    // Hostile cruisers holding station in the gas shadow. Stationary: a picket
    // is an emplacement, not a patrol. See the PICKET_* constants for the
    // layout rules. `keepClear` reserves a stretch of the band (distance along
    // the spine ± half-width) for a raid to come through without passing
    // inside a picket's cone.
    protected spawnPickets(count: number, keepClear?: { along: number; halfWidth: number }): void {
        const along = this.spineDirection();
        const inward = this.shadowNormal();
        const length = this.spineLength();

        // Stations as distances along the band, kept apart from each other and
        // inside the world once pushed back to their depth.
        const stations: { along: number; pos: Vector2 }[] = [];
        for (let attempt = 0; attempt < PICKET_PLACEMENT_ATTEMPTS && stations.length < count; attempt++) {
            const t = Phaser.Math.FloatBetween(0, length);
            if (stations.some(s => Math.abs(s.along - t) < PICKET_SPACING_PX)) continue;
            if (keepClear && Math.abs(t - keepClear.along) < keepClear.halfWidth) continue;
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
            this.hostiles.push(picket);
            this.targets.push(picket);
        }
    }

    // A raider that comes through the band: it starts `depth` px into the gas
    // from the spine at `along` (positive = towards the shadow side), pushes
    // straight out of the far edge, then flies at `destination`. It prosecutes
    // anything its radar finds on the way — and it cannot tell friend from
    // foe any better than the player can, so it goes for the traffic too.
    protected spawnRaider(along: number, depth: number, destination: Vector2): Target {
        const inward = this.shadowNormal();
        const start = this.spinePoint(along, depth);
        const exit = this.spinePoint(along, -RAIDER_EXIT_PX);
        const raider = this.add.target({
            x: start.x,
            y: start.y,
            direction: Phaser.Math.RadToDeg(Math.atan2(-inward.y, -inward.x)),
            speed: RAIDER_SPEED,
            type: 'cruiser',
            route: [exit, destination],
        });
        this.hostiles.push(raider);
        this.targets.push(raider);
        return raider;
    }

    // A friendly ship on the scene's books.
    protected addFriendly(ship: Target, callsign: string): Target {
        this.setCallsign(ship, callsign);
        this.friendlies.push(ship);
        this.targets.push(ship);
        return ship;
    }

    // Whether Disco's dish holds a track on this ship.
    protected stationTracks(ship: Target): boolean {
        if (!this.station || !ship.active || !ship.body) return false;
        return this.station.getTracks().some(track =>
            Phaser.Math.Distance.Between(ship.x, ship.y, track.pos.x, track.pos.y) < IDENTITY_MATCH_PX,
        );
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
        // Somebody else is talking: you do not key up over them.
        if (this.radio?.isBusy()) {
            this.showCommsHud('RADIO NET BUSY — STAND BY');
            return;
        }
        const call = this.comms.requestBogeyDope(this.player, this.station.getTracks(), this.identifyContact);
        this.showCommsHud(call ? `DISCO — ${this.describeCall(call)}` : 'DISCO — PICTURE CLEAN');
    };

    // Disco's own declaration of a datalink track. The dish sees geometry
    // only; the identity comes from what the player has put eyes on and what
    // the controller has declared.
    private identifyContact = (track: Track): ContactIdentity => {
        const on = (ship: Target) => ship.active && ship.body
            && Phaser.Math.Distance.Between(ship.x, ship.y, track.pos.x, track.pos.y) < IDENTITY_MATCH_PX;
        if (this.friendlies.some(ship => this.identified.has(ship.id) && on(ship))) return 'friendly';
        if (this.hostiles.some(ship => this.declaredHostile.has(ship.id) && on(ship))) return 'hostile';
        return 'bogey';
    };

    private describeCall(call: ContactCall): string {
        return `BRA ${String(call.bearing).padStart(3, '0')} FOR ${Math.round(call.rangePx)}, `
            + `${call.aspect.toUpperCase()}, ${call.identity.toUpperCase()} — ${call.speedOrder.toUpperCase()}`;
    }

    protected showCommsHud(text: string): void {
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

    private showRadioHud(transmission: RadioTransmission | null): void {
        if (!this.radioHud) return;
        if (!transmission) {
            this.radioHud.setVisible(false);
            return;
        }
        this.radioHud
            .setText(`${transmission.speaker}:  ${transmission.text}`)
            .setColor(transmission.color)
            .setVisible(true);
    }

    // Keep the subtitle at the top centre of the screen whatever the zoom:
    // a scroll-factor-0 object is still zoomed about the camera centre, so the
    // screen point is mapped back to the local point that lands on it (the
    // same correction InterfaceRenderer.positionRwr() makes).
    private pinRadioHud(): void {
        if (!this.radioHud?.visible) return;
        const cam = this.cameras.main;
        const centreX = cam.width * cam.originX;
        const centreY = cam.height * cam.originY;
        this.radioHud
            .setScale(1 / cam.zoom)
            .setPosition(centreX, (RADIO_HUD_TOP_MARGIN_PX - centreY) / cam.zoom + centreY);
    }

    private updateMissionHud(): void {
        const text = `${this.levelTitle()}\n${this.missionStatus()}`;
        if (this.missionHud && this.missionHud.text !== text) this.missionHud.setText(text);
    }

    // ── Per-frame ──

    update(time: number, delta: number): void {
        super.update(time, delta);
        // The net keeps talking even after the ship is gone — that is when the
        // verdict goes out.
        this.radio?.update();
        this.pinRadioHud();

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
        // final approach still has to set down and go, or it sits on the pad
        // forever.
        this.landArrivedTraffic();
        if (this.outcome) return;

        const parked = playerShipSettings.START_POSITION;
        if (this.airborneAt === undefined && this.isReadyForFlight()
            && Phaser.Math.Distance.Between(player.x, player.y, parked.x, parked.y) > AIRBORNE_DISTANCE_PX) {
            this.airborneAt = this.time.now;
            this.onAirborne?.();
        }

        // Disco passes each new contact as its track matures. Not while the
        // ship is still cold on the pad — the radio is not powered yet — and
        // not over scripted traffic. EMCON does not stop these: it silences
        // our transmitter, not our receiver.
        if (this.station && this.comms && this.isReadyForFlight() && !this.radio?.isBusy()) {
            const call = this.comms.announceNewContact(
                player, this.station.getTracks(), this.identifyContact, this.time.now,
            );
            if (call) this.showCommsHud(`DISCO — NEW CONTACT, ${this.describeCall(call)}`);
        }

        this.updateIdentification(player);
        this.updateLosses();
        if (!this.outcome) this.watchNoGoZone(player);
        if (!this.outcome) this.updateMission?.(player, delta);
        this.updateMissionHud();
    }

    // Visual identification: anything inside VID range is identified — a
    // friendly by its hull, a hostile declared on sight ("tally").
    private updateIdentification(player: PlayerShip): void {
        const inVid = (ship: Target) => ship.active && ship.body
            && Phaser.Math.Distance.Between(player.x, player.y, ship.x, ship.y) <= VID_RANGE_PX;

        for (const ship of this.friendlies) {
            if (this.identified.has(ship.id) || !inVid(ship)) continue;
            this.identified.add(ship.id);
            this.showCommsHud(`FLATSPIN 1-1 — VISUAL, FRIENDLY ${this.callsignOf(ship)}`);
            this.onFriendlyIdentified?.(ship);
            if (this.outcome) return;
        }
        for (const ship of this.hostiles) {
            if (this.identified.has(ship.id) || !inVid(ship)) continue;
            this.identified.add(ship.id);
            this.declaredHostile.add(ship.id);
            this.showCommsHud('FLATSPIN 1-1 — TALLY, HOSTILE');
            this.radio?.say('tally-hostile');
        }
    }

    // A friendly gone without having landed was destroyed; a hostile gone is
    // a splash.
    private updateLosses(): void {
        for (const ship of this.friendlies) {
            if (ship.active || this.landed.has(ship.id)) continue;
            this.onFriendlyLost(ship);
            return;
        }
        for (const ship of this.hostiles) {
            if (ship.active || this.splashed.has(ship.id)) continue;
            this.splashed.add(ship.id);
            this.declaredHostile.add(ship.id);
            this.showCommsHud(`SPLASH — ${this.callsignOf(ship)}`);
            if (this.onHostileDestroyed) this.onHostileDestroyed(ship);
            else this.radio?.say('splash', 'splash-ack');
        }
    }

    // Routed friendlies that have reached the pad drop onto it and are gone.
    private landArrivedTraffic(): void {
        for (const ship of this.friendlies) {
            if (!ship.active || !ship.body || this.landed.has(ship.id)) continue;
            if (ship.controller?.hasArrived()) this.landShip(ship);
        }
    }

    // Set a friendly down on the pad: it shrinks away as it descends — gliding
    // onto `touchdown` if it is not already over its spot — then the entity
    // goes: a landed ship is no longer a contact for anyone's radar.
    protected landShip(ship: Target, touchdown?: Vector2): void {
        if (this.landed.has(ship.id)) return;
        this.landed.add(ship.id);
        ship.controller?.destroy();
        ship.controller = undefined;
        ship.setVelocity(0, 0);
        // Descending below flight level: nothing up here can hit it any more.
        ship.setCollidesWith(0);
        this.tweens.add({
            targets: ship,
            // Not all the way to zero: the Matter body scales with the sprite,
            // and a zero-size body is degenerate geometry for the raycaster.
            scale: 0.05,
            ...(touchdown ? { x: touchdown.x, y: touchdown.y } : {}),
            duration: touchdown ? LANDING_GLIDE_MS : LANDING_MS,
            onComplete: () => {
                if (ship.active) ship.destroy();
            },
        });
        if (!this.outcome) this.onFriendlyLanded?.(ship);
    }

    // The no-go zone. Crossing the band draws a warning from Disco; being
    // tracked by a picket in its shadow ends the mission — not being seen is
    // the whole task, and the RWR's search warning is the cue to turn back
    // before that happens (an emitter is heard long before it gets an echo).
    private watchNoGoZone(player: PlayerShip): void {
        const behind = this.isBehindGas({ x: player.x, y: player.y });
        if (behind && !this.behindGas) {
            this.showCommsHud('DISCO — FLATSPIN, YOU ARE BEHIND THE GAS. NO PICTURE THERE — COME EAST');
            this.radio?.say('nogo-warning');
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
                this.failMission('DETECTED BY A HOSTILE PICKET BEHIND THE GAS', 'fail-detected');
                return;
            }
        }
    }

    // ── Verdicts ──

    protected failMission(reason: string, ...radio: RadioLineKey[]): void {
        if (this.outcome) return;
        this.outcome = 'failed';
        // Take the controls away: the verdict is in, the ship holds where it is.
        const player = this.player;
        if (player) {
            player.controller?.destroy();
            player.controller = undefined;
            player.setCurrentSpeed(0);
        }
        if (radio.length > 0) this.radio?.interrupt(...radio);
        this.showOutcome(`MISSION FAILED — ${reason}`, '#ff0000');
    }

    // A win lets the last exchange finish before the debrief goes out.
    protected completeMission(text: string, ...radio: RadioLineKey[]): void {
        if (this.outcome) return;
        this.outcome = 'complete';
        this.radio?.say(...radio);
        this.showOutcome(`MISSION COMPLETE — ${text}`, '#00ff00');
    }

    protected showOutcome(text: string, color: string): void {
        super.showOutcome(text, color);
        const next = this.outcome === 'complete'
            ? (this.nextLevel() ? 'ENTER  next mission' : 'ENTER  campaign complete — back to menu')
            : 'ENTER  retry';
        const cam = this.cameras.main;
        this.add.text(cam.centerX, cam.centerY + 60, `${next}      M  menu`, {
            font: '18px Courier',
            color: '#aaaaaa',
            backgroundColor: '#000000aa',
            padding: { x: 12, y: 6 },
        }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(1000);
    }

    private onContinue = () => {
        if (!this.outcome) return;
        if (this.outcome === 'failed') {
            this.scene.restart();
            return;
        }
        this.scene.start(this.nextLevel() ?? 'StartMenu');
    };

    private onMenu = () => {
        if (this.outcome) this.scene.start('StartMenu');
    };

    // Mark identified ships on the tactical picture: a ring in datalink cyan
    // around a friendly, red around a declared hostile — the contacts on the
    // scope whose identity is known.
    private drawIdentified(graphics: Phaser.GameObjects.Graphics): void {
        const ring = (ship: Target, colour: number) => {
            graphics.lineStyle(1, colour, 0.8);
            graphics.strokeCircle(ship.x, ship.y, Math.max(ship.displayWidth, ship.displayHeight) / 2 + 10);
        };
        for (const ship of this.friendlies) {
            if (ship.active && ship.body && this.identified.has(ship.id)) ring(ship, 0x00aeef);
        }
        for (const ship of this.hostiles) {
            if (ship.active && ship.body && this.identified.has(ship.id)) ring(ship, 0xff3030);
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

    protected isBehindGas(pos: Vector2): boolean {
        const padSide = Math.sign(this.sideOfSpine(PAD_POSITION));
        return Math.sign(this.sideOfSpine(pos)) === -padSide;
    }

    // Perpendicular distance from the spine, positive into the shadow.
    protected depthBehindSpine(pos: Vector2): number {
        const inward = this.shadowNormal();
        return (pos.x - GAS_FROM.x) * inward.x + (pos.y - GAS_FROM.y) * inward.y;
    }

    // Inside the gas capsule itself.
    protected isInGas(pos: Vector2): boolean {
        return Math.abs(this.depthBehindSpine(pos)) <= gasCloudSettings.RADIUS;
    }

    protected spineLength(): number {
        return Phaser.Math.Distance.Between(GAS_FROM.x, GAS_FROM.y, GAS_TO.x, GAS_TO.y);
    }

    // The point `along` px up the spine from its start, pushed `depth` px off
    // it (positive into the shadow, negative towards the pad).
    protected spinePoint(along: number, depth = 0): Vector2 {
        const dir = this.spineDirection();
        const inward = this.shadowNormal();
        return {
            x: GAS_FROM.x + dir.x * along + inward.x * depth,
            y: GAS_FROM.y + dir.y * along + inward.y * depth,
        };
    }

    // Unit vector along the spine, from its start to its end.
    private spineDirection(): Vector2 {
        const length = this.spineLength();
        return { x: (GAS_TO.x - GAS_FROM.x) / length, y: (GAS_TO.y - GAS_FROM.y) / length };
    }

    // Unit normal to the spine pointing into the shadow, away from the pad.
    protected shadowNormal(): Vector2 {
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
        if (!this.player) return;
        // The verdict is the loss of the ship; Disco is the one who notices.
        if (!this.outcome) {
            this.outcome = 'failed';
            this.radio?.interrupt('fail-lost');
        }
        super.destroyPlayer();
        this.station?.destroy();
        this.station = undefined;
    }
}
