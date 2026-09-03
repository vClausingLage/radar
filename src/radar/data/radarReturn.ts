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
// computer gets to see.
export type RadarReturn = {
  point: Phaser.Math.Vector2;
  range: number;
  angle: number;
}
