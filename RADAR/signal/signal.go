package signal

import (
	"fmt"
	Vector "radar/vector"
)

type Signal struct {
	Position    Vector.Vector3
	Directivity Vector.Vector3
	Speed       float64
}

func New(position, direction Vector.Vector3, speed float64) *Signal {
	return &Signal{position, direction, speed}
}

func (s *Signal) Move() {
	fmt.Println("Moving signal" + s.Position.String())
	// s.Position.Add(*s.Directivity.Normalize().Scale(s.Speed))
	s.Position.X += s.Directivity.X * s.Speed
	s.Position.Y += s.Directivity.Y * s.Speed
	s.Position.Z += s.Directivity.Z * s.Speed
}
