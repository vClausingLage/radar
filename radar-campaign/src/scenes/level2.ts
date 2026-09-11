import Phaser from "phaser";
import CampaignLevel, { PAD_POSITION } from "./campaignLevel";
import { PlayerShip, Target } from "../entities/ship";
import { TowLine } from "../entities/towLine";
import { RadioLineKey } from "../audio/radioNet";
import { gasCloudSettings } from "../radar/data/radarGameSettings";
import { playerShipSettings } from "../settings";

// Where the crippled survey ship is found: this far up the gas spine, and
// this far out of the band on the friendly side, drifting back towards it.
// The drift is slow, but it is the clock: the player has to cold-start, cross
// to her and pass a line before she slides back into the gas.
const LANTERN_ALONG_PX = 1080;
const LANTERN_OFFSET_PX = gasCloudSettings.RADIUS + 360;
const LANTERN_DRIFT_SPEED = 0.018;

// Passing the tow line: hold alongside, inside this range and no faster than
// a third of full ahead, for this long. Drifting out of position loses the
// line and it has to be passed again.
const HOOKUP_RANGE_PX = 130;
const HOOKUP_MAX_SPEED = playerShipSettings.SPEED / 3 + 0.005;
const HOOKUP_MS = 5000;

// Home: a tow brought this close to the pad is cast off and set down — from
// flight level, so the tug never has to cross the ground (which only takes a
// ship landing tail-first; see physics/landing.ts). She glides down onto the
// pad beside the player's own parking spot.
const HOME_RADIUS_PX = 300;
const LANTERN_TOUCHDOWN = { x: 1280, y: 2290 };

// The raider that crippled her comes out of the gas once she is under tow —
// out of the southern stretch of the band, well clear of the picket line
// (which is kept off that stretch so none of them has it in its cone).
const RAIDER_ALONG_PX = 650;
const RAIDER_DEPTH_PX = 40;
const PICKET_KEEP_CLEAR_PX = 700;

type Phase = 'search' | 'alongside' | 'tow' | 'home';

// Campaign — Level 2, "Shepherd". A survey ship, Lantern 5, came off worst
// against something in the gas: reactor scrammed, transmitter dark, drifting
// out of the band and now back into it. The player finds her, identifies her
// by eye, holds alongside to pass a tow line and drags her home — and on the
// way the raider that did it comes back through the gas to finish the job.
//
// Lantern is a hulk, not a ship: no controller, radar in EMCON, engines out.
// She moves only by the way she had on, and then only by the tow line.
export default class Level2 extends CampaignLevel {
    private lantern?: Target;
    private raider?: Target;
    private towLine?: TowLine;
    private phase: Phase = 'search';
    private hookupMs = 0;
    private raiderSeen = false;

    constructor() {
        super('Level2');
    }

    protected levelTitle(): string {
        return 'LEVEL 2 — SHEPHERD';
    }

    protected nextLevel(): string {
        return 'Level3';
    }

    protected briefingMessage(): string {
        return 'LEVEL 2 — SHEPHERD. The survey ship Lantern 5 is disabled and drifting back into the gas. Find her and identify her by eye, then hold alongside at 1/3 or slower until the tow line is across, and tow her to the pad. Whatever crippled her is still out there. If she drifts into the gas, the pickets will have her.';
    }

    protected buildMission(): void {
        this.towLine = undefined;
        this.raider = undefined;
        this.phase = 'search';
        this.hookupMs = 0;
        this.raiderSeen = false;

        this.spawnPickets(2, { along: RAIDER_ALONG_PX, halfWidth: PICKET_KEEP_CLEAR_PX });

        const start = this.spinePoint(LANTERN_ALONG_PX, -LANTERN_OFFSET_PX);
        const inward = this.shadowNormal();
        const lantern = this.addFriendly(this.add.target({
            x: start.x,
            y: start.y,
            direction: Phaser.Math.RadToDeg(Math.atan2(inward.y, inward.x)),
            speed: LANTERN_DRIFT_SPEED,
            type: 'cargo',
            side: 'friendly',
        }), 'LANTERN 5');
        // A dead ship: no brain, no emitter, no plumes. What way she has on,
        // she keeps — nothing in space takes it off her.
        lantern.controller?.destroy();
        lantern.controller = undefined;
        lantern.radar.enterEmcon();
        lantern.shutDownEngines();
        this.lantern = lantern;
    }

    protected missionStatus(): string {
        switch (this.phase) {
            case 'search':
                return 'TASKING — FIND AND VID THE DRIFTER BEFORE SHE REACHES THE GAS';
            case 'alongside':
                return `TASKING — HOLD ALONGSIDE AT 1/3 OR SLOWER — TOW LINE ${Math.round((this.hookupMs / HOOKUP_MS) * 100)}%`;
            case 'tow':
            case 'home':
                return 'TASKING — TOW LANTERN 5 TO THE PAD';
        }
    }

    protected openingTransmissions(): RadioLineKey[] {
        return ['l2-brief-1', 'l2-brief-2', 'l2-checkin'];
    }

    protected onAirborne(): void {
        this.radio?.say('l2-airborne', 'l2-tasking');
    }

    protected onFriendlyIdentified(): void {
        if (this.phase !== 'search') return;
        this.phase = 'alongside';
        this.radio?.say('l2-vid', 'l2-lantern-1', 'l2-alongside');
    }

    protected onFriendlyLost(): void {
        this.failMission('LANTERN 5 LOST', 'l2-fail-lost');
    }

    protected onHostileDestroyed(ship: Target): void {
        if (ship === this.raider) this.radio?.say('splash', 'splash-ack', 'l2-thanks');
    }

    protected onFriendlyLanded(): void {
        this.completeMission('LANTERN 5 IS HOME', 'l2-complete', 'l2-complete-2');
    }

    protected updateMission(player: PlayerShip, delta: number): void {
        const lantern = this.lantern;
        if (!lantern?.active || !lantern.body) return;

        if (this.graphics) this.towLine?.update(this.graphics);

        // Loose, she drifts — and the gas is where her way is taking her.
        if (this.phase === 'search' || this.phase === 'alongside') {
            if (this.isInGas({ x: lantern.x, y: lantern.y })) {
                this.failMission('LANTERN 5 DRIFTED INTO THE GAS', 'l2-fail-drift');
                return;
            }
        }

        if (this.phase === 'alongside') this.passTowLine(player, lantern, delta);

        if (this.phase === 'tow') {
            this.watchRaider();
            if (Phaser.Math.Distance.Between(lantern.x, lantern.y, PAD_POSITION.x, PAD_POSITION.y) <= HOME_RADIUS_PX) {
                this.phase = 'home';
                this.towLine?.release();
                this.landShip(lantern, LANTERN_TOUCHDOWN);
            }
        }
    }

    // Station-keeping while the line goes across: close, slow, and steady.
    private passTowLine(player: PlayerShip, lantern: Target, delta: number): void {
        const close = Phaser.Math.Distance.Between(player.x, player.y, lantern.x, lantern.y) <= HOOKUP_RANGE_PX;
        const slow = Math.abs(player.getCurrentSpeed()) <= HOOKUP_MAX_SPEED;
        this.hookupMs = close && slow ? this.hookupMs + delta : 0;
        if (this.hookupMs < HOOKUP_MS) return;

        this.phase = 'tow';
        this.towLine = new TowLine(player, lantern);
        this.showCommsHud('LANTERN 5 — TOW LINE FAST');
        this.radio?.say('l2-hooked');

        // Whoever did this has been waiting for someone to come for her.
        this.raider = this.spawnRaider(RAIDER_ALONG_PX, RAIDER_DEPTH_PX, PAD_POSITION);
    }

    // The raider pops up on Disco's scope as it leaves the gas: declared on
    // the spot — it is coming out of the enemy's side at a rescue.
    private watchRaider(): void {
        const raider = this.raider;
        if (this.raiderSeen || !raider?.active || !this.stationTracks(raider)) return;
        this.raiderSeen = true;
        this.declaredHostile.add(raider.id);
        this.showCommsHud('DISCO — POP-UP, SINGLE, HOT — HOSTILE. CLEARED HOT');
        this.radio?.say('l2-popup', 'l2-scared');
    }
}
