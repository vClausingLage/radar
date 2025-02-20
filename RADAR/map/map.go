package worldmap

import (
	"math"
	Signal "radar/signal"
)

func New(radius float64) *WorldMap {
	return &WorldMap{Radius: radius}
}

type WorldMap struct {
	Radius float64
}

func (m *WorldMap) Contains(s *Signal.Signal) bool {
	distance := math.Sqrt(s.Position.X*s.Position.X + s.Position.Y*s.Position.Y + s.Position.Z*s.Position.Z)
	return distance <= m.Radius
}
