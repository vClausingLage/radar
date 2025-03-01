package radar

import (
	"fmt"
	Signal "radar/signal"
	Vector "radar/vector"
)

type Radar struct {
	Position       Vector.Vector3
	PulseDirection Vector.Vector3
	Speed          float64
}

func New(position Vector.Vector3, pulseDirection Vector.Vector3, speed float64) *Radar {
	return &Radar{Position: position, PulseDirection: pulseDirection, Speed: speed}
}

func (r Radar) Transceive() *Signal.Signal {
	direction := r.PulseDirection.Normalize()
	return Signal.New(r.Position, *direction, r.Speed)
}

func (r *Radar) UpdatePulseDirection() {
	// Rotate the pulse direction
	fmt.Println("Updating pulse direction")
	r.PulseDirection = *r.PulseDirection.TurnDegrees(1)
	fmt.Println("Pulse direction updated" + r.PulseDirection.String())

}

// func (r Radar) Receive(signal Signal.Signal) Vector.Vector3 {
// 	// Receive a signal and return the position of the source
// 	// return signal.Move()
// }
