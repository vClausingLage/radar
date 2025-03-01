package signal

import (
	Vector "radar/vector"
)

type Signal struct {
	Position  Vector.Vector3
	Direction Vector.Vector3
	Speed     float64
}

func New(position, direction Vector.Vector3, speed float64) *Signal {
	return &Signal{position, direction, speed}
}

func (s *Signal) Move() {
	// fmt.Println("Moving signal" + s.Position.String())
	s.Position.X += s.Direction.X * s.Speed
	s.Position.Y += s.Direction.Y * s.Speed
	s.Position.Z += s.Direction.Z * s.Speed
}
