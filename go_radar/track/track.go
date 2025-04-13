package track

import Vector "radar/vector"

type Track struct {
	Position, Direction Vector.Vector3
	Speed               float64
}

func New(position, direction Vector.Vector3, speed float64) *Track {
	return &Track{position, direction, speed}
}
