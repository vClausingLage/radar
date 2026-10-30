// RWR (Radar Warning Receiver) module.
//
// Real-world equivalent: a passive receiver that detects incoming radar
// emissions. When an enemy radar illuminates this ship — either in RWS
// (search) or STT (fire-control lock) — the RWR registers a contact with
// the bearing to the emitter and whether it is in a lock state.
//
// In this simulation the signal path is:
//   Enemy Emitter hits this ship → RadarEventEmitter fires 'rwr-warn'/'rwr-lock'
//   → RwrReceiver records a RwrContact → InterfaceRenderer displays it.

import Phaser from 'phaser';
import type { PlayerShip, Target } from '../../../entities/ship';
import type { Entity, GasVolume } from '../../data/types';
import { RWR_CONTACT_TTL_MS } from '../../data/radarGameSettings';
import { beamPattern, emissionSignal, gasTransmission, isDetected } from '../../data/signalPath';

// Emitter keys. An RWR tells emitters apart by key alone: a ship radar (and
// that ship's jammer strobe, which replaces its search symbol) keys on the
// ship's entity id, a missile seeker on its own 'missile-N'. Every producer
// and reader goes through these, so the format is stated in one place.
const SEEKER_KEY_PREFIX = 'missile-';
export function shipEmitterKey(id: number | undefined): string {
  return id === undefined ? 'unknown' : String(id);
}
export function seekerEmitterKey(n: number): string {
  return `${SEEKER_KEY_PREFIX}${n}`;
}
export function isSeekerKey(key: string): boolean {
  return key.startsWith(SEEKER_KEY_PREFIX);
}

export type RwrContact = {
  bearingDeg: number;
  isLocked: boolean;     // true when source is in STT (fire-control lock)
  // True when this contact is an active jammer strobe — the emitter is
  // painting us with noise rather than sweeping us. Keyed by the jammer
  // ship's own id, so it replaces the plain search symbol for that ship
  // while the burst runs.
  isJammer?: boolean;
  lastSeenAt: number;    // Phaser.time.now for aging out stale contacts
  // The emitter lies where a flight member's datalinked position says a
  // wingman is - so it is the wingman's own radar. Kept on the contact (it
  // still refreshes and ages like any other) but hidden from every reader:
  // not displayed, not hunted. Only ever set on a search contact: a lock is
  // never marked friendly (see receive).
  friendly?: boolean;
};

export class RwrReceiver {
  private contacts: Map<string, RwrContact> = new Map();
  // Supplied by a radar that shares a flight datalink: does an emitter heard
  // on this bearing correspond to a wingman? An RWR measures only bearing, so
  // that is all the question can be.
  private friendFilter: ((bearingDeg: number) => boolean) | null = null;

  setFriendFilter(filter: ((bearingDeg: number) => boolean) | null): void {
    this.friendFilter = filter;
  }

  // Called by the Radar when it detects an incoming emission from a known
  // bearing. `key` uniquely identifies the emitter (e.g. entity id or
  // missile id as a string) so contacts can be deduplicated; `isJammer`
  // marks a jamming strobe (coveringJammers in jammer.ts).
  receive(key: string, bearingDeg: number, isLocked: boolean, now: number, isJammer = false): void {
    // A lock is never a friend's: a flight's fire control cannot lock a
    // datalinked wingman (displayedTracks excludes them), so a lock on us is an
    // enemy's however well its bearing lines up with the wingman's - and
    // hiding it would blind EVADE exactly when an enemy shoots from behind
    // the wingman. A missile seeker is never a friend either.
    const friendly = !isLocked && !isSeekerKey(key) && (this.friendFilter?.(bearingDeg) ?? false);
    this.contacts.set(key, { bearingDeg, isLocked, isJammer, lastSeenAt: now, friendly });
  }

  // Purge contacts whose signal has not been refreshed within the TTL.
  tick(now: number): void {
    for (const [key, contact] of this.contacts) {
      if (now - contact.lastSeenAt > RWR_CONTACT_TTL_MS) {
        this.contacts.delete(key);
      }
    }
  }

  // What the RWR reports to the pilot: everything except wingmen.
  getRwrSignals(): RwrContact[] {
    return Array.from(this.contacts.values()).filter(c => !c.friendly);
  }

  // The emitters heard that were identified as wingmen and hidden from the
  // picture - for tests and debugging; nothing in play reads this.
  getFriendlyContacts(): RwrContact[] {
    return Array.from(this.contacts.values()).filter(c => c.friendly);
  }

  // The emitter key behind every live contact. Ship radars key on the emitting
  // ship's entity id, missile seekers on their own 'missile-N' key, so this is
  // what tells a search radar apart from an inbound seeker.
  getRwrSources(): string[] {
    return Array.from(this.contacts.entries()).filter(([, c]) => !c.friendly).map(([k]) => k);
  }

  // The loudest platform — a ship radar, not a missile seeker — locked first.
  // A seeker's bearing points at the weapon, which is something to defend
  // against, never something to fly toward; a platform is worth hunting.
  getPlatformContact(): RwrContact | null {
    let best: RwrContact | null = null;
    for (const [key, contact] of this.contacts) {
      if (isSeekerKey(key) || contact.friendly) continue;
      if (!best || (contact.isLocked && !best.isLocked)) best = contact;
    }
    return best;
  }

  getPrimaryRwrContact(): RwrContact | null {
    const all = this.getRwrSignals();
    if (all.length === 0) return null;
    // Locked contacts take priority; among equal priority, bearing is irrelevant.
    return all.sort((a, b) => (b.isLocked ? 1 : 0) - (a.isLocked ? 1 : 0))[0];
  }

  // Placeholder: missile time-to-active text for HUD.
  // Populated when a missile is fired at this ship.
  getLastFiredMissileHudText(): string | null {
    return null;
  }
}

// One pulse (or one STT fan of rays) arriving at the ships around a radar.
export type Illumination = {
  emitterKey: string;
  emitterPos: { x: number; y: number };
  // The emitting radar's rated range, which its energy budget is quoted at.
  ratedRange: number;
  listeners: Entity[];
  beamLines: Phaser.Geom.Line[];
  beamCentreDeg: number;
  beamWidthDeg: number;
  // The beam's gain on boresight (beamGain x any scan loss).
  mainGain: number;
  isLocked: boolean;
  testSidelobes: boolean;
  gasVolumes: GasVolume[];
  // The listener's hull as the emitter's raycaster reads it.
  polygonOf: (entity: Entity) => Phaser.Geom.Polygon;
  now: number;
};

// Notify every ship the beam touches that it is being illuminated, so its
// RWR registers a contact: unlocked (green, search) or locked (red, STT).
// A beam sampled by several rays still illuminates each ship once.
//
// Being warned is a one-way problem: the receiver only has to hear the
// pulse, where a return has to survive the trip out and back again. So a
// ship is warned from ranges at which the emitting radar has no hope of
// tracking it - sitting outside the rated range protects nobody from knowing
// they are being looked at. Gas on the path costs the pulse energy once here,
// not twice: nothing is coming back through it.
//
// The gain a listener hears: a hull the beam is actually resting on
// (the pulse ray crosses it — the crossing point sits on the boresight
// ray) hears the beam's full gain; a hull wholly off the beam hears the
// amplitude pattern at its own bearing off the beam centre — the skirt
// just off the main lobe, decaying smoothly down to the flat sidelobe
// floor. Being just off the instantaneous beam sounds nearly as loud as
// being under it, which is what a real antenna's main-lobe skirt does, while
// far-off listeners still only catch the sidelobe leak.
//
// `testSidelobes` gates that off-beam test to once per sweep leg
// (the caller passes it true only on sweepComplete) rather than every
// frame. It has to be rate-limited somehow: detectionProbability's floor
// is RADAR_PFA, never truly zero, so a channel re-rolled every single
// frame for hundreds of frames running will eventually cross it no matter
// how weak the real signal is — exactly the false-alarm mechanic working
// as intended, just aimed at one specific ship every frame instead of at
// a random cell a few times a sweep. Once per sweep leg keeps the
// sidelobe roll at the same cadence a real search radar would actually
// offer a listener, in main beam or not.
export function illuminateRwrs(p: Illumination): void {
  for (const entity of p.listeners) {
    if (!hasRwr(entity)) continue;
    const polygon = p.polygonOf(entity);
    const inMainBeam = p.beamLines.some(line => Phaser.Geom.Intersects.GetLineToPolygon(line, polygon));
    if (!inMainBeam && !p.testSidelobes) continue;

    const epos = entity.getPosition();
    const range = Phaser.Math.Distance.Between(p.emitterPos.x, p.emitterPos.y, epos.x, epos.y);
    let gain = p.mainGain;
    if (!inMainBeam) {
      // Off the beam: the listener catches the pattern's skirt at its own
      // bearing off the beam centre — near the lobe nearly full, far out only
      // the sidelobe floor.
      const bearingToDeg = Phaser.Math.RadToDeg(
        Math.atan2(epos.y - p.emitterPos.y, epos.x - p.emitterPos.x),
      );
      gain = p.mainGain * beamPattern(
        Math.abs(Phaser.Math.Angle.WrapDegrees(bearingToDeg - p.beamCentreDeg)),
        p.beamWidthDeg,
      );
    }
    const transmission = gasTransmission(p.emitterPos, epos, p.gasVolumes);
    if (!isDetected(emissionSignal(range, p.ratedRange, transmission, gain))) continue;

    const bearingDeg = Phaser.Math.RadToDeg(
      Math.atan2(p.emitterPos.y - epos.y, p.emitterPos.x - epos.x),
    );
    // A sidelobe leak reads as an ordinary (green) search contact even
    // during STT — it is catching leakage off a beam not aimed at it,
    // not the beam itself, so it does not earn the lock warning or the
    // event. Only a ship the main beam is actually resting on gets that.
    const locked = p.isLocked && inMainBeam;
    entity.radar.rwrReceiver.receive(p.emitterKey, bearingDeg, locked, p.now);
    if (locked) entity.radar.eventEmitter.onRwrLock();
  }
}

// Ships carry the warning receiver; terrain does not.
function hasRwr(entity: Entity): entity is PlayerShip | Target {
  return 'radar' in entity;
}
