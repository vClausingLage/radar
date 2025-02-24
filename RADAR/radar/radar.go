package radar

import (
	Signal "radar/signal"
	Vector "radar/vector"
)

type Radar struct {
	Position       Vector.Vector3
	PulseDirection Vector.Vector3
}

func New(position Vector.Vector3, pulseDirection Vector.Vector3) *Radar {
	return &Radar{Position: position, PulseDirection: pulseDirection}
}

func (r Radar) Transmit() *Signal.Signal {
	direction := r.PulseDirection.Normalize()
	return Signal.New(r.Position, *direction, 1.0)
}

func (r Radar) UpdatePulseDirection() {
	// Rotate the pulse direction
	r.PulseDirection = *Vector.New(2, 0, 0)

}

// func (r Radar) Receive(signal Signal.Signal) Vector.Vector3 {
// 	// Receive a signal and return the position of the source
// 	// return signal.Move()
// }
