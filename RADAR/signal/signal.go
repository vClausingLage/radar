package signal

import (
	Vector "radar/vector"
)

type Signal struct {
	Position  Vector.Vector3
	Direction Vector.Vector3
	Frequency float64
}

func New(position, direction Vector.Vector3, frequency float64) *Signal {
	return &Signal{position, direction, frequency}
}
