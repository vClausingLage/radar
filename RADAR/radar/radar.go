package radar

import (
	"fmt"
	Signal "radar/signal"
	Target "radar/target"
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

func (r *Radar) Transceive(rng float64, tgt []Target.Target) {
	fmt.Print(rng)
	direction := r.PulseDirection.Normalize()
	s := Signal.New(r.Position, *direction, 1)
	m := r.Position.Add(*direction.Scale(rng))
	fmt.Printf("Drawing line from %v to %v\n", r.Position, m)
	fmt.Print("freq:", s.Frequency)
}

func (r *Radar) UpdatePulseDirection() {
	r.PulseDirection = *r.PulseDirection.TurnDegrees(1)
}
