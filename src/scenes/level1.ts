import Phaser from "phaser";
import CampaignLevel, { PAD_POSITION, STATION_POSITION } from "./campaignLevel";
import { Target } from "../entities/ship";
import { RadioLineKey } from "../audio/radioNet";
import { Vector2 } from "../types";
import { PlayerShip } from "../entities/ship";

// Inbound traffic: cargo ships coming down from the north, east of the dish,
// to the pad. They start staggered along the lane so they arrive one after
// another, and land beside the player's parking spot, not on it.
//
// The middle of their route is the lesson. East of the dish lies a rock field
// ("the Scree"), and the lane swings through it on an arc centred on Disco's
// own rock: all the way round, the haulers fly square across the dish's line of
// sight. That is the notch — no radial speed, among clutter — and the dish's
// clutter filter throws them out with the rocks. Their speed along the line of
// sight is a matter of where it is measured from, though: from the south, where
// the player comes up from the pad, the same arc runs nearly straight at the
// radar, and a hull Disco cannot hold is a plain contact on the player's own
// scope.
// Far enough out that a hauler broadside to the dish — its brightest aspect —
// has no margin left to burn through the notch on Disco's power; any nearer
// and the dish holds it anyway.
const SCREE_RADIUS_PX = 1000;
// The arc, as bearings from the dish (degrees, clockwise from east), in steps
// short enough that each leg stays within a few degrees of square to Disco.
const SCREE_FROM_DEG = -45;
const SCREE_TO_DEG = 45;
const SCREE_STEP_DEG = 6;
// Rocks along the arc: mostly just outside it, so their faces towards the dish
// sit within a CFAR window of the lane and fill its cells with clutter; a few
// inside it, between the dish and the lane, to shadow it as well.
const SCREE_OUTER_OFFSET_PX = 120;
const SCREE_INNER_OFFSET_PX = -140;
const SCREE_ROCK_RADIUS_PX = 50;
const SCREE_OUTER_ROCKS_DEG = [-42, -33, -24, -15, -6, 3, 12, 21, 30, 39];
const SCREE_INNER_ROCKS_DEG = [-28, -2, 24];
// Disco says it once, when the first hauler it has been calling fades in there.
const SCREE_LOST_DELAY_MS = 4000;

function screePoint(bearingDeg: number, offsetPx = 0): Vector2 {
    const rad = Phaser.Math.DegToRad(bearingDeg);
    const r = SCREE_RADIUS_PX + offsetPx;
    return { x: STATION_POSITION.x + Math.cos(rad) * r, y: STATION_POSITION.y + Math.sin(rad) * r };
}

const SCREE_ARC: Vector2[] = [];
for (let deg = SCREE_FROM_DEG; deg <= SCREE_TO_DEG; deg += SCREE_STEP_DEG) SCREE_ARC.push(screePoint(deg));

const TRAFFIC_ROUTE: Vector2[] = [
    ...SCREE_ARC,
    { x: PAD_POSITION.x + 50, y: PAD_POSITION.y + 50 },
];
// Nearest first; each with its call sign and what it says when the player
// puts eyes on it. (Mule 2-3 is late. Mule 2-3 is always late.) They come down
// the lane north of the Scree, straight at the dish, where Disco holds them.
const TRAFFIC_LANE_X = SCREE_ARC[0].x;
const TRAFFIC: { start: Vector2; callsign: string; reply: RadioLineKey }[] = [
    { start: { x: TRAFFIC_LANE_X, y: 1050 }, callsign: 'MULE 2-1', reply: 'l1-mule21' },
    { start: { x: TRAFFIC_LANE_X, y: 600 }, callsign: 'MULE 2-2', reply: 'l1-mule22' },
    { start: { x: TRAFFIC_LANE_X, y: 150 }, callsign: 'MULE 2-4', reply: 'l1-mule24' },
];
const TRAFFIC_SPEED = 0.15;

// Campaign — Level 1, "Mule Train". The ship sits powered down on the pad;
// the player brings it to life with the cold-start procedure (BAT, ENG1, ENG2,
// SYS) while Anvil briefs over the radio. The tasking: friendly cargo traffic
// is inbound from the north to this pad with transponders off, and the player
// has to identify each hauler visually — radar cannot tell a friendly cargo
// ship's return from anyone else's. Disco datalinks its contacts in cyan,
// passes each new one over the radio as it forms, and answers C ("bogey
// dope") with the nearest contact's BRAA picture and a speed order.
//
// West of the gas band is the no-go zone: Disco cannot see through the gas,
// and hostile pickets are holding in its shadow. The mission fails if a picket
// gets a track on the player, or if the player shoots down the traffic.
export default class Level1 extends CampaignLevel {
    private replies = new Map<number, RadioLineKey>();
    // Haulers the dish has held a track on, and when it first lost one in the
    // Scree; Disco's call about it goes out once.
    private heldByDisco = new Set<number>();
    private lostInScreeAt?: number;
    private screeCalled = false;

    constructor() {
        super('Level1');
    }

    protected levelTitle(): string {
        return 'LEVEL 1 — MULE TRAIN';
    }

    protected nextLevel(): string {
        return 'Level2';
    }

    protected briefingMessage(): string {
        return 'LEVEL 1 — MULE TRAIN. Cold ship on the pad: run BAT, ENG1, ENG2, SYS. Tasking: friendly cargo traffic is inbound from the north to this pad. Radar cannot tell friend from bogey — close to visual range and identify each one. Disco (cyan datalink) calls new contacts and answers C with a bogey dope. The gas band to the west is a no-go line: Disco has no picture behind it and hostile pickets hold there. If a picket tracks you, or you shoot the traffic, the mission is over. Your RWR rings for every radar that touches you, the haulers\' included: a tone from the west is a picket\'s. Your hull is bigger than theirs, and a bigger hull is seen from further off. The lane swings through the Scree, the rock field east of Disco, square across the dish\'s beam: a radar throws out what crosses it among rocks (the Doppler notch), so Disco will lose them there. Look from where they fly at you.';
    }

    protected buildMission(): void {
        this.replies.clear();
        this.heldByDisco.clear();
        this.lostInScreeAt = undefined;
        this.screeCalled = false;
        this.spawnPickets(4);
        this.buildScree();
        this.spawnTraffic();
    }

    // The rock field the lane runs through. Terrain like any other: it
    // shadows, it shows on the ground map, and every radar that sweeps it logs
    // its faces as clutter — which is what switches the clutter filter in.
    private buildScree(): void {
        const place = (deg: number, offset: number) => this.registerTerrain(this.add.asteroid({
            position: screePoint(deg, offset),
            direction: 0,
            speed: 0,
            bodyRadius: SCREE_ROCK_RADIUS_PX,
            spin: false,
            angle: deg * 7,
        }));
        SCREE_OUTER_ROCKS_DEG.forEach(deg => place(deg, SCREE_OUTER_OFFSET_PX));
        SCREE_INNER_ROCKS_DEG.forEach(deg => place(deg, SCREE_INNER_OFFSET_PX));
    }

    // Friendly cargo inbound down the lane east of the gas, staggered so they
    // reach the pad one at a time. Cargo never attacks — it flies its route and
    // defends itself if locked — so the only thing that distinguishes it from
    // the pickets is the side it is on, which no sensor in the game can read.
    private spawnTraffic(): void {
        for (const { start, callsign, reply } of TRAFFIC) {
            const cargo = this.addFriendly(this.add.target({
                x: start.x,
                y: start.y,
                direction: 90,
                speed: TRAFFIC_SPEED,
                type: 'cargo',
                side: 'friendly',
                route: TRAFFIC_ROUTE,
            }), callsign);
            this.replies.set(cargo.id, reply);
        }
    }

    protected missionStatus(): string {
        const seen = this.friendlies.filter(cargo => this.identified.has(cargo.id)).length;
        return `TASKING — VID INBOUND TRAFFIC ${seen}/${this.friendlies.length}   NO-GO WEST OF THE GAS`;
    }

    // Disco tells the player once when a hauler it has been holding fades out
    // in the Scree: it is not gone, it is in the notch — of the dish's radar.
    protected updateMission(_player: PlayerShip): void {
        if (this.screeCalled) return;
        let lostOne = false;
        for (const cargo of this.friendlies) {
            if (!cargo.active || !cargo.body || this.landed.has(cargo.id)) continue;
            if (this.stationTracks(cargo)) {
                this.heldByDisco.add(cargo.id);
            } else if (this.heldByDisco.has(cargo.id) && this.inScree(cargo)) {
                lostOne = true;
            }
        }
        if (!lostOne) {
            this.lostInScreeAt = undefined;
            return;
        }
        this.lostInScreeAt ??= this.time.now;
        if (this.time.now - this.lostInScreeAt >= SCREE_LOST_DELAY_MS && !this.radio?.isBusy()) {
            this.screeCalled = true;
            this.radio?.say('l1-scree');
        }
    }

    // On the arc: the right distance from the dish, between its two ends.
    private inScree(ship: Target): boolean {
        const range = Phaser.Math.Distance.Between(STATION_POSITION.x, STATION_POSITION.y, ship.x, ship.y);
        const bearing = Phaser.Math.RadToDeg(Math.atan2(ship.y - STATION_POSITION.y, ship.x - STATION_POSITION.x));
        return Math.abs(range - SCREE_RADIUS_PX) < SCREE_OUTER_OFFSET_PX + SCREE_ROCK_RADIUS_PX
            && bearing >= SCREE_FROM_DEG && bearing <= SCREE_TO_DEG;
    }

    protected openingTransmissions(): RadioLineKey[] {
        return ['l1-brief-1', 'l1-brief-2', 'l1-brief-3', 'l1-checkin'];
    }

    protected onAirborne(): void {
        this.radio?.say('l1-airborne', 'l1-tasking');
    }

    protected onFriendlyIdentified(ship: Target): void {
        const reply = this.replies.get(ship.id);
        this.radio?.say('l1-vid', ...(reply ? [reply] : []));
        if (this.friendlies.every(cargo => this.identified.has(cargo.id))) {
            this.completeMission('ALL INBOUND TRAFFIC IDENTIFIED', 'l1-complete', 'l1-complete-2');
        }
    }

    // The traffic is down. If the player never put eyes on every hauler the
    // tasking can no longer be done, and the mission would otherwise sit open
    // forever with no verdict - and, since a mission is left through its
    // verdict, no way out but closing the game.
    protected onFriendlyLanded(): void {
        if (this.friendlies.every(cargo => this.landed.has(cargo.id))
            && !this.friendlies.every(cargo => this.identified.has(cargo.id))) {
            this.failMission('TRAFFIC LANDED UNIDENTIFIED', 'l1-fail-unidentified');
        }
    }

    protected onFriendlyLost(): void {
        this.failMission('FRIENDLY TRAFFIC DESTROYED', 'fail-fratricide');
    }
}
