package search

import (
	Worldmap "radar/map"
	Radar "radar/radar"
)

type SearchCycle struct {
	Radar    Radar.Radar
	WorldMap Worldmap.WorldMap
}

func New(radar Radar.Radar, worldMap Worldmap.WorldMap) *SearchCycle {
	return &SearchCycle{Radar: radar, WorldMap: worldMap}
}

func (s *SearchCycle) Search(m *Worldmap.WorldMap) {
	for range int(3) {
		s.Radar.Transceive(m.Radius, m.Targets)
		s.Radar.UpdatePulseDirection()
	}
}
