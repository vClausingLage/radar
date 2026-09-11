import CampaignLevel from "./campaignLevel";
import { Target } from "../entities/ship";
import { RadioLineKey } from "../audio/radioNet";
import { Vector2 } from "../types";

// Inbound traffic: cargo ships flying the lane down the east side of the gas
// to the pad. They start staggered along the lane so they arrive one after
// another, and land beside the player's parking spot, not on it.
const TRAFFIC_ROUTE: Vector2[] = [
    { x: 1900, y: 1500 },
    { x: 1900, y: 2100 },
    { x: 1450, y: 2350 },
];
// Nearest first; each with its call sign and what it says when the player
// puts eyes on it. (Mule 2-3 is late. Mule 2-3 is always late.)
const TRAFFIC: { start: Vector2; callsign: string; reply: RadioLineKey }[] = [
    { start: { x: 1900, y: 1050 }, callsign: 'MULE 2-1', reply: 'l1-mule21' },
    { start: { x: 1900, y: 500 }, callsign: 'MULE 2-2', reply: 'l1-mule22' },
    { start: { x: 1900, y: 80 }, callsign: 'MULE 2-4', reply: 'l1-mule24' },
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
        return 'LEVEL 1 — MULE TRAIN. Cold ship on the pad: run BAT, ENG1, ENG2, SYS. Tasking: friendly cargo traffic is inbound from the north to this pad. Radar cannot tell friend from bogey — close to visual range and identify each one. Disco (cyan datalink) calls new contacts and answers C with a bogey dope. The gas band to the west is a no-go line: Disco has no picture behind it and hostile pickets hold there. If a picket tracks you, or you shoot the traffic, the mission is over.';
    }

    protected buildMission(): void {
        this.replies.clear();
        this.spawnPickets(3);
        this.spawnTraffic();
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

    protected onFriendlyLost(): void {
        this.failMission('FRIENDLY TRAFFIC DESTROYED', 'fail-fratricide');
    }
}
