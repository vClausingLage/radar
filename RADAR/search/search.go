package search

import (
	Worldmap "radar/map"
	Radar "radar/radar"
	"time"
)

type SearchCycle struct {
	Radar    Radar.Radar
	WorldMap Worldmap.WorldMap
}

func New(radar Radar.Radar, worldMap Worldmap.WorldMap) *SearchCycle {
	return &SearchCycle{Radar: radar, WorldMap: worldMap}
}

func pulse(s *SearchCycle) {
	signal := s.Radar.Transmit()
	maxSteps := s.WorldMap.Radius / signal.Speed
	for range int(maxSteps + 1) {
		signal.Move()
		if !s.WorldMap.Contains(signal) {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
}

func (s *SearchCycle) Search(m *Worldmap.WorldMap) {
	for range int(3) {
		pulse(s)
		s.Radar.UpdatePulseDirection()
	}
}
