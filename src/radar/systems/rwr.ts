import { Ship } from "../../entities/ship";
import { Asteroid } from "../../entities/asteroid";
import { radarModule } from "../../settings";
import { GameMath } from "../../math";

const RWR_DETECTION_POWER = 1.5e7;

export type RwrContact = {
  targetId: number;
  bearingDeg: number;
  distance: number;
  isLocked: boolean;
};

export type RwrEmitter = {
  emitterId: string;
  x: number;
  y: number;
  headingDeg: number;
  azimuth: number;
  range: number;
  lockedTargetId: number | null;
};

export class RWR {
  private alert = false;
  private contacts: RwrContact[] = [];

  getAlert(): boolean {
    return this.alert;
  }

  getContacts(): RwrContact[] {
    return this.contacts;
  }

  getPrimaryContact(): RwrContact | null {
    if (this.contacts.length === 0) return null;

    const sorted = [...this.contacts].sort((a, b) => {
      if (a.isLocked !== b.isLocked) {
        return a.isLocked ? -1 : 1;
      }
      return a.distance - b.distance;
    });

    return sorted[0];
  }

  receive(
    targets: Array<Ship & { id: number }>,
    asteroids: Asteroid[],
    _range: number,
    owner: Ship | null,
    extraEmitters: RwrEmitter[] = []
  ): void {
    if (!owner) {
      this.alert = false;
      this.contacts = [];
      return;
    }

    const ownerId = (owner as { id?: number }).id;
    if (typeof ownerId !== 'number') {
      this.alert = false;
      this.contacts = [];
      return;
    }

    this.alert = false;
    this.contacts = [];
    const dedupedContacts = new Map<string | number, RwrContact>();

    for (const target of targets) {
      const distance = GameMath.getDistance(target.x, target.y, owner.x, owner.y);
      if (target.radar.getEmitterPowerAtRange(distance) < RWR_DETECTION_POWER) continue;

      if (target.radar.getMode() === 'emcon') continue;

      const emitterHeading = target.getDirection();
      const emitterHalfAzimuth = target.radar.getAzimuth() / 2;
      const startAngle = emitterHeading - emitterHalfAzimuth;
      const endAngle = emitterHeading + emitterHalfAzimuth;

      const angleToOwner = GameMath.normalizeAngle(
        Phaser.Math.RadToDeg(Math.atan2(owner.y - target.y, owner.x - target.x))
      );
      const normalizedStartAngle = GameMath.normalizeAngle(startAngle);
      const normalizedEndAngle = GameMath.normalizeAngle(endAngle);

      let isInCone = false;
      if (normalizedStartAngle > normalizedEndAngle) {
        isInCone = angleToOwner >= normalizedStartAngle || angleToOwner <= normalizedEndAngle;
      } else {
        isInCone = angleToOwner >= normalizedStartAngle && angleToOwner <= normalizedEndAngle;
      }

      if (!isInCone) continue;

      const isLocked = target.radar.alertTargetBeingTracked() === ownerId;

      // Check that the line from target to owner is not obstructed by an asteroid
      const line = new Phaser.Geom.Line(target.x, target.y, owner.x, owner.y);
      let obstructed = false;

      for (const asteroid of asteroids) {
        if (Phaser.Geom.Intersects.LineToCircle(line, asteroid.getCircle())) {
          obstructed = true;
          break;
        }
      }

      if (!obstructed) {
        const bearingDeg = Phaser.Math.RadToDeg(Math.atan2(target.y - owner.y, target.x - owner.x));
        const existing = dedupedContacts.get(target.id);

        if (!existing) {
          dedupedContacts.set(target.id, {
            targetId: target.id,
            bearingDeg,
            distance,
            isLocked,
          });
        } else {
          dedupedContacts.set(target.id, {
            ...existing,
            isLocked: existing.isLocked || isLocked,
            distance: Math.min(existing.distance, distance),
            bearingDeg,
          });
        }
      }
    }

    for (const emitter of extraEmitters) {
      const distance = GameMath.getDistance(emitter.x, emitter.y, owner.x, owner.y);
      const emitterPowerAtReceiver = emitter.range * radarModule.RWR_RANGE_MULTIPLICATOR / Math.max(distance, 1);
      if (emitterPowerAtReceiver < 1) continue;

      const emitterHeading = emitter.headingDeg;
      const startAngle = emitterHeading - emitter.azimuth;
      const endAngle = emitterHeading + emitter.azimuth;

      const angleToOwner = GameMath.normalizeAngle(
        Phaser.Math.RadToDeg(Math.atan2(owner.y - emitter.y, owner.x - emitter.x))
      );
      const normalizedStartAngle = GameMath.normalizeAngle(startAngle);
      const normalizedEndAngle = GameMath.normalizeAngle(endAngle);

      let isInCone = false;
      if (normalizedStartAngle > normalizedEndAngle) {
        isInCone = angleToOwner >= normalizedStartAngle || angleToOwner <= normalizedEndAngle;
      } else {
        isInCone = angleToOwner >= normalizedStartAngle && angleToOwner <= normalizedEndAngle;
      }

      if (!isInCone) continue;

      const line = new Phaser.Geom.Line(emitter.x, emitter.y, owner.x, owner.y);
      let obstructed = false;

      for (const asteroid of asteroids) {
        if (Phaser.Geom.Intersects.LineToCircle(line, asteroid.getCircle())) {
          obstructed = true;
          break;
        }
      }

      if (obstructed) continue;

      const bearingDeg = Phaser.Math.RadToDeg(Math.atan2(emitter.y - owner.y, emitter.x - owner.x));
      dedupedContacts.set(emitter.emitterId, {
        targetId: emitter.lockedTargetId ?? -1,
        bearingDeg,
        distance,
        isLocked: emitter.lockedTargetId === ownerId,
      });
    }

    this.contacts = Array.from(dedupedContacts.values());
    this.alert = this.contacts.length > 0;
  }
}
