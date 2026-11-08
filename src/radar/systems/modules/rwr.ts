// RWR (Radar Warning Receiver) module.
//
// Real-world equivalent: a passive receiver that detects incoming radar
// emissions. When an enemy radar illuminates this ship — either in RWS
// (search) or STT (fire-control lock) — the RWR registers a contact with
// the bearing to the emitter and whether it is in a lock state.
//
// In this simulation the signal path is:
//   Enemy Emitter hits this ship → receive() records a RwrContact
//   → InterfaceRenderer displays it.

import { RWR_CONTACT_TTL_MS } from '../../data/radarGameSettings';

// The emitter-key prefix marking a contact as a missile seeker rather than a
// ship's radar. Minted by MissileRadar ('missile-N' per seeker); read here,
// by the AI's missile-inbound check and by the tests — one constant, so the
// protocol cannot silently drift between the four.
export const RWR_SEEKER_KEY_PREFIX = 'missile-';

// What an emission's own signal parameters say about its source. A real RWR
// does not know who is out there; it measures each pulse train's band, pulse
// width and repetition rate and matches them against a threat library. Here
// the emitter hands its signature over with the pulse, and the library below
// is the RWR's — the emitter does not get to decide what it is drawn as.
//   'ship-radar'         a ship's search or tracking radar
//   'vim177-illuminator' a ship's STT switched to guidance: a VIM-177 rides the
//                        energy it reflects off its target, so the lock changes
//                        character the moment one is in flight. The missile
//                        itself emits nothing — this is the only trace of it,
//                        and it points at the shooter.
//   'vim220-seeker'      a VIM-220's own active seeker, at the missile itself
export type EmitterSignature = 'ship-radar' | 'vim177-illuminator' | 'vim220-seeker';

// The threat library: signatures that mean a missile is guiding on us, and the
// number the scope shows for each.
const MISSILE_THREATS: Partial<Record<EmitterSignature, string>> = {
  'vim177-illuminator': '7',
  'vim220-seeker': '22',
};

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
  // The threat library's answer for this emission: the missile designation
  // ('7', '22') when its signature is a missile guiding on us, else unset —
  // a ship's radar.
  missile?: string;
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
  // marks a jamming strobe (registerJammingStrobes in systems/radar.ts);
  // `signature` is what the pulse train measures as (see EmitterSignature).
  receive(
    key: string,
    bearingDeg: number,
    isLocked: boolean,
    now: number,
    isJammer = false,
    signature: EmitterSignature = 'ship-radar',
  ): void {
    // A lock is never a friend's: a flight's fire control cannot lock a
    // datalinked wingman (displayedTracks excludes them), so a lock on us is an
    // enemy's however well its bearing lines up with the wingman's - and
    // hiding it would blind EVADE exactly when an enemy shoots from behind
    // the wingman. A missile seeker is never a friend either.
    const friendly = !isLocked && !key.startsWith(RWR_SEEKER_KEY_PREFIX) && (this.friendFilter?.(bearingDeg) ?? false);
    const missile = MISSILE_THREATS[signature];
    this.contacts.set(key, { bearingDeg, isLocked, isJammer, lastSeenAt: now, friendly, missile });
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
  // ship's entity id, missile seekers on their own RWR_SEEKER_KEY_PREFIX key,
  // so this is what tells a search radar apart from an inbound seeker.
  getRwrSources(): string[] {
    return Array.from(this.contacts.entries()).filter(([, c]) => !c.friendly).map(([k]) => k);
  }

  // The loudest platform — a ship radar, not a missile seeker — locked first.
  // A seeker's bearing points at the weapon, which is something to defend
  // against, never something to fly toward; a platform is worth hunting.
  getPlatformContact(): RwrContact | null {
    let best: RwrContact | null = null;
    for (const [key, contact] of this.contacts) {
      if (key.startsWith(RWR_SEEKER_KEY_PREFIX) || contact.friendly) continue;
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
}
