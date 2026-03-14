import { Track } from '../data/track'
import { VisibleTarget } from './radarDetection'

export class TwsTrackManager {
  updateTracks(existingTracks: Track[], visibleTargets: VisibleTarget[], maxTracks = 3): Track[] {
    const updatedTracks: Track[] = []
    const usedTargetIds = new Set<number>()

    for (const track of existingTracks) {
      const matchingTarget = visibleTargets.find((entry) => entry.target.id === track.id)
      if (!matchingTarget) {
        continue
      }

      updatedTracks.push({
        id: matchingTarget.target.id,
        pos: { x: matchingTarget.target.x, y: matchingTarget.target.y },
        dist: matchingTarget.distance,
        dir: matchingTarget.target.getDirection(),
        speed: matchingTarget.target.getSpeed(),
        age: track.age + 1,
        lastUpdate: 0,
        confidence: Math.min(track.confidence + 0.1, 1.0),
      })
      usedTargetIds.add(matchingTarget.target.id)
    }

    if (updatedTracks.length < maxTracks) {
      const unusedTargets = visibleTargets
        .filter((entry) => !usedTargetIds.has(entry.target.id))
        .sort((a, b) => a.distance - b.distance)

      for (const entry of unusedTargets) {
        if (updatedTracks.length >= maxTracks) {
          break
        }

        updatedTracks.push({
          id: entry.target.id,
          pos: { x: entry.target.x, y: entry.target.y },
          dist: entry.distance,
          dir: entry.target.getDirection(),
          speed: entry.target.getSpeed(),
          age: 0,
          lastUpdate: 0,
          confidence: 0.5,
        })
      }
    }

    return updatedTracks
  }
}
