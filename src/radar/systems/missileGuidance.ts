import { ActiveRadarMissile, Missile } from '../../entities/missiles'
import { Ship } from '../../entities/ship'
import { Track } from '../data/track'

type MissileMode = 'stt' | 'tws' | string

type GuidanceVector = {
  targetDirX: number
  targetDirY: number
}

export class MissileGuidance {
  private missileUpdateDelta = 0

  updateMissiles(
    activeMissiles: Missile[],
    delta: number,
    mode: MissileMode,
    sttTrack: Track | null,
    tracks: Track[],
    targets: Array<Ship & { id: number }>
  ): Missile[] {
    let updatedMissiles = activeMissiles.filter((missile) => missile.active)

    this.missileUpdateDelta += delta
    if (this.missileUpdateDelta >= 1000) {
      updatedMissiles = updatedMissiles.filter((missile) => {
        if (missile.missileAge <= missile.missileBurnTime) {
          missile.missileAge += 1
          return true
        }

        missile.destroy()
        return false
      })
      this.missileUpdateDelta = 0
    }

    for (const missile of updatedMissiles) {
      const currentDirX = missile.direction.x
      const currentDirY = missile.direction.y

      let targetDirX = currentDirX
      let targetDirY = currentDirY

      if (missile.missileAge < 2) {
        ;({ targetDirX, targetDirY } = this.flyInDirectionOfShip(missile))
      } else {
        const trackResult = this.trackInDirectionOfTarget(missile, mode, sttTrack, tracks, targets)
        if (trackResult) {
          ;({ targetDirX, targetDirY } = trackResult)
        }
      }

      const turnFactor = Math.min((missile.missileTurnSpeed * delta) / 1000, 1)
      missile.direction.x = currentDirX + (targetDirX - currentDirX) * turnFactor
      missile.direction.y = currentDirY + (targetDirY - currentDirY) * turnFactor

      const dirMag = Math.sqrt(missile.direction.x * missile.direction.x + missile.direction.y * missile.direction.y)
      if (dirMag > 0) {
        missile.direction.x /= dirMag
        missile.direction.y /= dirMag
      }

      missile.updateHeading(missile.direction.x, missile.direction.y)
    }

    return updatedMissiles
  }

  flyInDirectionOfShip(missile: Missile): GuidanceVector {
    return { targetDirX: missile.direction.x, targetDirY: missile.direction.y }
  }

  trackInDirectionOfTarget(
    missile: Missile,
    mode: MissileMode,
    sttTrack: Track | null,
    tracks: Track[],
    targets: Array<Ship & { id: number }>
  ): GuidanceVector | null {
    if (missile instanceof ActiveRadarMissile && missile.isActiveRadarEnabled()) {
      const activeTarget = this.acquireActiveRadarTarget(missile, targets)
      if (activeTarget) {
        return this.getInterceptVector(
          missile,
          { x: activeTarget.x, y: activeTarget.y },
          activeTarget.getDirection(),
          activeTarget.getSpeed()
        )
      }
    }

    let targetTrack: Track | null = null

    if (mode === 'stt' && sttTrack) {
      targetTrack = sttTrack
    } else if (mode === 'tws' && missile.targetId !== undefined) {
      targetTrack = tracks.find((track) => track.id === missile.targetId) || null
    }

    if (!targetTrack) {
      return null
    }

    return this.getInterceptVector(missile, targetTrack.pos, targetTrack.dir, targetTrack.speed)
  }

  private acquireActiveRadarTarget(
    missile: ActiveRadarMissile,
    targets: Array<Ship & { id: number }>
  ): (Ship & { id: number }) | null {
    const assignedTarget =
      missile.activeRadarTargetId !== null
        ? targets.find((target) => target.id === missile.activeRadarTargetId && target.active) ?? null
        : null

    if (assignedTarget && this.isTargetInsideActiveRadarBasket(missile, assignedTarget, true)) {
      return assignedTarget
    }

    const preferredTarget =
      missile.targetId !== undefined
        ? targets.find((target) => target.id === missile.targetId && target.active) ?? null
        : null

    if (preferredTarget && this.isTargetInsideActiveRadarBasket(missile, preferredTarget, false)) {
      missile.activeRadarTargetId = preferredTarget.id
      return preferredTarget
    }

    const fallbackTarget =
      targets
        .filter((target) => target.active)
        .filter((target) => this.isTargetInsideActiveRadarBasket(missile, target, false))
        .sort(
          (left, right) =>
            Phaser.Math.Distance.Between(missile.x, missile.y, left.x, left.y) -
            Phaser.Math.Distance.Between(missile.x, missile.y, right.x, right.y)
        )[0] ?? null

    missile.activeRadarTargetId = fallbackTarget?.id ?? null
    return fallbackTarget
  }

  private isTargetInsideActiveRadarBasket(
    missile: ActiveRadarMissile,
    target: Ship & { id: number },
    isAlreadyTracking: boolean
  ): boolean {
    const distance = Phaser.Math.Distance.Between(missile.x, missile.y, target.x, target.y)
    if (distance > missile.activeRadarRange) {
      return false
    }

    if (isAlreadyTracking) {
      return true
    }

    const angleToTarget = Phaser.Math.RadToDeg(Math.atan2(target.y - missile.y, target.x - missile.x))
    const missileHeading = Phaser.Math.RadToDeg(Math.atan2(missile.direction.y, missile.direction.x))
    const delta = Math.abs(Phaser.Math.Angle.WrapDegrees(angleToTarget - missileHeading))
    return delta <= missile.activeRadarAzimuth
  }

  private getInterceptVector(
    missile: Missile,
    targetPosition: { x: number; y: number },
    targetDirectionDeg: number,
    targetSpeed: number
  ): GuidanceVector | null {
    const angleRad = Phaser.Math.DegToRad(targetDirectionDeg)
    const targetVelocity = {
      x: Math.cos(angleRad) * targetSpeed,
      y: Math.sin(angleRad) * targetSpeed,
    }

    const relPos = {
      x: targetPosition.x - missile.x,
      y: targetPosition.y - missile.y,
    }

    const a =
      targetVelocity.x * targetVelocity.x +
      targetVelocity.y * targetVelocity.y -
      missile.missileSpeed * missile.missileSpeed

    const b = 2 * (relPos.x * targetVelocity.x + relPos.y * targetVelocity.y)
    const c = relPos.x * relPos.x + relPos.y * relPos.y

    let interceptTime = 0

    if (Math.abs(a) < 0.001) {
      if (Math.abs(b) < 0.001) {
        return null
      }
      interceptTime = -c / b
    } else {
      const discriminant = b * b - 4 * a * c
      if (discriminant < 0) {
        return null
      }

      const t1 = (-b + Math.sqrt(discriminant)) / (2 * a)
      const t2 = (-b - Math.sqrt(discriminant)) / (2 * a)

      if (t1 > 0 && t2 > 0) {
        interceptTime = Math.min(t1, t2)
      } else if (t1 > 0) {
        interceptTime = t1
      } else if (t2 > 0) {
        interceptTime = t2
      } else {
        return null
      }
    }

    const interceptPos = {
      x: targetPosition.x + targetVelocity.x * interceptTime,
      y: targetPosition.y + targetVelocity.y * interceptTime,
    }

    const direction = {
      x: interceptPos.x - missile.x,
      y: interceptPos.y - missile.y,
    }

    const mag = Math.sqrt(direction.x * direction.x + direction.y * direction.y)
    if (mag === 0) {
      return null
    }

    return {
      targetDirX: direction.x / mag,
      targetDirY: direction.y / mag,
    }
  }
}
