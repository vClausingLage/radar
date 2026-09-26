import Phaser from "phaser";

// A reflection the beam found, before the receiver has decided whether there
// was enough energy in it to count as a return. It carries what the signal
// budget needs beyond the geometry: how much hull was presented to the beam,
// and how much of the pulse survived the medium on the way there and back.
export type BeamHit = {
  point: Phaser.Math.Vector2;
  // Hull cross-section relative to the reference hull (see data/signalPath.ts).
  crossSection: number;
  // Round-trip transmission through gas on this path; 1 in clear space.
  transmission: number;
}

// A reflection that made it through the receiver: this is what the tracking
// computer gets to see. `signal` is the effective signal ratio the group of
// hits was detected on (after non-coherent integration, scintillation and
// CFAR — the same number the detection test judged), and it is the amplitude
// the tracking computer's centroid is weighted by: a real set's monopulse
// comparator forms the target's bearing from exactly this — how much of the
// beam pattern each look came back with — so the loudest look steers the
// contact and a marginal edge-of-beam look barely moves it.
export type RadarReturn = {
  point: Phaser.Math.Vector2;
  range: number;
  angle: number;
  // Signal ratio the detection was made on (>= RADAR_PFA by construction).
  signal: number;
}
