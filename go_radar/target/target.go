package target

import Vector "radar/vector"

type Target struct {
	Position, Direction Vector.Vector3
	Speed               float64
}

func New(position, direction Vector.Vector3, speed float64) *Target {
	return &Target{position, direction, speed}
}
