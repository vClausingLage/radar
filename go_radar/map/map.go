package worldmap

import (
	"math"
	Target "radar/target"
	Vector "radar/vector"
)

type WorldMap struct {
	Radius  float64
	Targets []Target.Target
}

func New(radius float64) *WorldMap {
	return &WorldMap{Radius: radius}
}

func (m *WorldMap) Contains(v *Vector.Vector3) bool {
	distance := math.Sqrt(v.X*v.X + v.Y*v.Y + v.Z*v.Z)
	return distance <= m.Radius
}

func (m *WorldMap) AddTarget(position, direction Vector.Vector3, speed float64) {
	newTarget := *Target.New(position, direction, speed)
	if m.Contains(&newTarget.Position) {
		m.Targets = append(m.Targets, newTarget)
	} else {
		panic("Target is outside the world map")
	}
}
