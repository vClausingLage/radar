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

import { RWR_CONTACT_TTL_MS } from '../../data/radarGameSettings';

export type RwrContact = {
  bearingDeg: number;
  isLocked: boolean;     // true when source is in STT (fire-control lock)
  lastSeenAt: number;    // Phaser.time.now for aging out stale contacts
};

export class RwrReceiver {
  private contacts: Map<string, RwrContact> = new Map();

  // Called by the Radar when it detects an incoming emission from a known
  // bearing. `key` uniquely identifies the emitter (e.g. entity id or
  // missile id as a string) so contacts can be deduplicated.
  receive(key: string, bearingDeg: number, isLocked: boolean, now: number): void {
    this.contacts.set(key, { bearingDeg, isLocked, lastSeenAt: now });
  }

  // Purge contacts whose signal has not been refreshed within the TTL.
  tick(now: number): void {
    for (const [key, contact] of this.contacts) {
      if (now - contact.lastSeenAt > RWR_CONTACT_TTL_MS) {
        this.contacts.delete(key);
      }
    }
  }

  getRwrSignals(): RwrContact[] {
    return Array.from(this.contacts.values());
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
