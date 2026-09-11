import Phaser from "phaser";
import CampaignLevel, { PAD_POSITION, STATION_POSITION } from "./campaignLevel";
import { Target } from "../entities/ship";
import { RadioLineKey } from "../audio/radioNet";
import { Vector2 } from "../types";

// Mule 2-3 comes through the middle of the band, heading for the pad. It is a
// hauler with a dead transponder: to every sensor it is a bogey, exactly like
// what follows it.
const MULE_ALONG_PX = 1100;
const MULE_SPEED = 0.13;
const MULE_LANDING: Vector2 = { x: 1300, y: 2330 };
// It comes out this long after the player is off the pad.
const MULE_DELAY_MS = 20000;

// The raid: two cruisers line abreast, far enough apart along the band that
// neither has the other in its cone, a little deeper in the gas than Mule —
// they are chasing him. They enter the band once he has a lead on them: the
// gas soaks up their radar as well as Disco's, so from the far side of it
// they cannot hold him, and he comes out with the length of the band between
// them. (Much less, and they shoot him down inside it, before the dish has
// a picture or the player a chance.) If he is held up, they come anyway.
const RAID_SPACING_PX = 170;
const RAID_DEPTH_PX = 120;
const RAID_MULE_LEAD_PX = 550;
const RAID_LATEST_MS = 90000;
// One goes for the pad, one for the dish. Their route ends short of the
// target: a raider over the target is the loss, not one parked on it.
const RAID_TARGETS: { destination: Vector2; name: string }[] = [
    { destination: { x: PAD_POSITION.x, y: PAD_POSITION.y - 120 }, name: 'THE PAD' },
    { destination: { x: STATION_POSITION.x - 250, y: STATION_POSITION.y }, name: 'THE DISH' },
];
// Any raider this close to the pad or the dish has reached it.
const RAID_TARGET_RADIUS_PX = 260;

// Campaign — Level 3, "Backdoor". The picket line behind the gas has gone
// dark; the player holds a CAP between the gas and the pad. First out of the
// cloud is Mule 2-3, the straggler, transponder dead — a bogey until the
// player looks. Behind him come two raiders, declared hostile by Disco the
// moment the dish holds them. Neither may reach the pad or the dish, and the
// hauler has to make it down.
export default class Level3 extends CampaignLevel {
    private mule?: Target;
    private raiders: { ship: Target; name: string }[] = [];
    private muleSpawnAt?: number;
    private muleStart?: Vector2;
    private raidDueAt?: number;
    private muleSeen = false;
    private raidSeen = false;

    constructor() {
        super('Level3');
    }

    protected levelTitle(): string {
        return 'LEVEL 3 — BACKDOOR';
    }

    protected briefingMessage(): string {
        return 'LEVEL 3 — BACKDOOR. The picket line behind the gas has gone dark. Hold between the gas and the pad. Mule 2-3 is overdue with a dead transponder — whatever comes out of the gas is a bogey until you have eyes on it. Nothing hostile reaches the pad or the dish, and Mule 2-3 has to make it down.';
    }

    protected buildMission(): void {
        this.mule = undefined;
        this.raiders = [];
        this.muleSpawnAt = undefined;
        this.muleStart = undefined;
        this.raidDueAt = undefined;
        this.muleSeen = false;
        this.raidSeen = false;
        // No pickets: they are the raid.
    }

    protected missionStatus(): string {
        if (!this.mule) return 'TASKING — HOLD BETWEEN THE GAS AND THE PAD';
        const splashed = this.raiders.filter(r => !r.ship.active).length;
        const mule = this.landed.has(this.mule.id) ? 'DOWN' : this.identified.has(this.mule.id) ? 'IDENTIFIED' : 'BOGEY';
        const raid = this.raiders.length > 0 ? `   RAIDERS SPLASHED ${splashed}/${this.raiders.length}` : '';
        return `TASKING — MULE 2-3: ${mule}${raid}`;
    }

    protected openingTransmissions(): RadioLineKey[] {
        return ['l3-brief-1', 'l3-brief-2', 'l3-checkin'];
    }

    protected onAirborne(): void {
        this.radio?.say('l3-airborne', 'l3-tasking');
        this.muleSpawnAt = this.time.now + MULE_DELAY_MS;
    }

    protected onFriendlyIdentified(ship: Target): void {
        if (ship !== this.mule) return;
        this.radio?.say('l3-mule23-1', 'l3-vid-mule', 'l3-mule23-2');
    }

    protected onFriendlyLost(): void {
        this.failMission('MULE 2-3 LOST', 'l3-fail-lost');
    }

    protected onFriendlyLanded(): void {
        this.radio?.say('l3-mule-landed');
        this.checkComplete();
    }

    protected onHostileDestroyed(): void {
        const left = this.raiders.filter(r => r.ship.active).length;
        this.radio?.say('splash', left > 0 ? 'l3-one-left' : 'splash-ack');
        this.checkComplete();
    }

    private checkComplete(): void {
        if (!this.mule || !this.landed.has(this.mule.id)) return;
        if (this.raiders.length === 0 || this.raiders.some(r => r.ship.active)) return;
        this.completeMission('THE DOOR HELD', 'l3-complete', 'l3-complete-2');
    }

    protected updateMission(): void {
        const now = this.time.now;

        if (!this.mule && this.muleSpawnAt !== undefined && now >= this.muleSpawnAt) {
            this.spawnMule();
            this.raidDueAt = now + RAID_LATEST_MS;
        }
        if (this.raiders.length === 0 && this.raidDueAt !== undefined && this.raidIsDue(now)) {
            this.spawnRaid();
        }

        // Pop-ups: Disco calls what the dish can hold, when it can hold it —
        // unless the player has already put eyes on it.
        if (this.mule && !this.muleSeen && this.stationTracks(this.mule)) {
            this.muleSeen = true;
            if (!this.identified.has(this.mule.id)) {
                this.showCommsHud('DISCO — POP-UP, SINGLE, NO SQUAWK — BOGEY. VID, DO NOT ENGAGE');
                this.radio?.say('l3-popup-mule');
            }
        }
        if (!this.raidSeen && this.raiders.some(r => this.stationTracks(r.ship))) {
            this.raidSeen = true;
            this.raiders.forEach(r => this.declaredHostile.add(r.ship.id));
            this.showCommsHud('DISCO — TWO NEW CONTACTS — HOSTILE, HOSTILE. CLEARED HOT');
            this.radio?.say('l3-popup-raid', 'l3-condition-red');
        }

        for (const { ship, name } of this.raiders) {
            if (!ship.active || !ship.body) continue;
            const overPad = Phaser.Math.Distance.Between(ship.x, ship.y, PAD_POSITION.x, PAD_POSITION.y) <= RAID_TARGET_RADIUS_PX;
            const overDish = Phaser.Math.Distance.Between(ship.x, ship.y, STATION_POSITION.x, STATION_POSITION.y) <= RAID_TARGET_RADIUS_PX;
            if (overPad || overDish) {
                this.failMission(`RAIDERS REACHED ${overPad ? 'THE PAD' : name}`, 'l3-fail-raid');
                return;
            }
        }
    }

    private raidIsDue(now: number): boolean {
        if (now >= (this.raidDueAt ?? Infinity)) return true;
        const mule = this.mule;
        if (!mule?.active || !mule.body || !this.muleStart) return true;
        return Phaser.Math.Distance.Between(mule.x, mule.y, this.muleStart.x, this.muleStart.y) >= RAID_MULE_LEAD_PX;
    }

    private spawnMule(): void {
        const inward = this.shadowNormal();
        const start = this.spinePoint(MULE_ALONG_PX, 0);
        this.muleStart = start;
        const exit = this.spinePoint(MULE_ALONG_PX, -300);
        this.mule = this.addFriendly(this.add.target({
            x: start.x,
            y: start.y,
            direction: Phaser.Math.RadToDeg(Math.atan2(-inward.y, -inward.x)),
            speed: MULE_SPEED,
            type: 'cargo',
            side: 'friendly',
            route: [exit, MULE_LANDING],
        }), 'MULE 2-3');
    }

    private spawnRaid(): void {
        RAID_TARGETS.forEach(({ destination, name }, i) => {
            const along = MULE_ALONG_PX + (i === 0 ? -RAID_SPACING_PX : RAID_SPACING_PX);
            const ship = this.spawnRaider(along, RAID_DEPTH_PX, destination);
            this.setCallsign(ship, `RAIDER ${i + 1}`);
            this.raiders.push({ ship, name });
        });
    }
}
