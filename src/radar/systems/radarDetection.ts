import { RadarOptions } from '../../types'
import { Asteroid } from '../../entities/asteroid'
import { Ship } from '../../entities/ship'
import { GameMath } from '../../math'

export type RadarTarget = Ship & { id: number }

export type VisibleTarget = {
  target: RadarTarget
  distance: number
}

export class RadarDetection {
  constructor(private readonly radarOptions: RadarOptions) {}

  filterTargetsAndAsteroidsInScanArea(
    startAngle: number,
    endAngle: number,
    targets: RadarTarget[],
    asteroids: Asteroid[]
  ): { targetsInRange: RadarTarget[]; asteroidsInRange: Asteroid[] } {
    const targetsInRange = targets.filter((target) => {
      const dx = target.x - this.radarOptions.position.x
      const dy = target.y - this.radarOptions.position.y
      const distance = Math.sqrt(dx * dx + dy * dy)
      const angleToTarget = Phaser.Math.RadToDeg(Math.atan2(dy, dx))

      return distance <= this.radarOptions.range && this.isInScanCone(angleToTarget, startAngle, endAngle)
    })

    const asteroidsInRange = asteroids.filter((asteroid) => {
      const dx = asteroid.x - this.radarOptions.position.x
      const dy = asteroid.y - this.radarOptions.position.y
      const distance = Math.sqrt(dx * dx + dy * dy)
      const angleToAsteroid = Phaser.Math.RadToDeg(Math.atan2(dy, dx))

      return distance <= this.radarOptions.range && this.isInScanCone(angleToAsteroid, startAngle, endAngle)
    })

    return { targetsInRange, asteroidsInRange }
  }

  getVisibleTargets(targetsInRange: RadarTarget[], asteroidsInRange: Asteroid[]): VisibleTarget[] {
    const targetCircles = targetsInRange.map((t) => t.getCircle())
    const asteroidCircles = asteroidsInRange.map((a) => a.getCircle())
    const allCircles = [...targetCircles, ...asteroidCircles]

    return targetsInRange
      .map((target) => {
        const hasCollision = this.isTargetOccluded(target, allCircles)
        if (hasCollision) {
          return null
        }

        const dx = target.x - this.radarOptions.position.x
        const dy = target.y - this.radarOptions.position.y
        const distance = Math.sqrt(dx * dx + dy * dy)

        return { target, distance }
      })
      .filter((entry): entry is VisibleTarget => entry !== null)
  }

  private isInScanCone(angle: number, startAngle: number, endAngle: number): boolean {
    const normalizedAngle = GameMath.normalizeAngle(angle)
    const normalizedStartAngle = GameMath.normalizeAngle(startAngle)
    const normalizedEndAngle = GameMath.normalizeAngle(endAngle)

    if (normalizedStartAngle > normalizedEndAngle) {
      return normalizedAngle >= normalizedStartAngle || normalizedAngle <= normalizedEndAngle
    }

    return normalizedAngle >= normalizedStartAngle && normalizedAngle <= normalizedEndAngle
  }

  private isTargetOccluded(target: RadarTarget, circles: Phaser.Geom.Circle[]): boolean {
    const radarPosition = this.radarOptions.position
    const circle = target.getCircle()

    const cardinalPoints = [
      { x: circle.right, y: circle.y },
      { x: circle.left, y: circle.y },
      { x: circle.x, y: circle.top },
      { x: circle.x, y: circle.bottom },
    ]

    let unobstructedLines = 0

    for (const point of cardinalPoints) {
      const line = new Phaser.Geom.Line(radarPosition.x, radarPosition.y, point.x, point.y)

      let lineHasObstruction = false

      for (const otherCircle of circles) {
        const isSameCircle =
          otherCircle.x === circle.x &&
          otherCircle.y === circle.y &&
          otherCircle.radius === circle.radius

        if (isSameCircle) {
          continue
        }

        if (Phaser.Geom.Intersects.LineToCircle(line, otherCircle)) {
          lineHasObstruction = true
          break
        }
      }

      if (!lineHasObstruction) {
        unobstructedLines++
      }
    }

    return unobstructedLines === 0
  }
}
