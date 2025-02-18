package signal

import Vector "radar/vector"

type Signal struct {
	Position    Vector.Vector3
	Directivity Vector.Vector3
	Speed       float64
}

func New(position, direction Vector.Vector3, speed float64) Signal {
	return Signal{position, direction, speed}
}

func (s Signal) Move() Vector.Vector3 {
	return s.Position.Add(s.Directivity.Normalize().Scale(s.Speed))
}
