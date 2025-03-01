package search

import (
	"fmt"
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

func pulse(s *SearchCycle) {
	signal := s.Radar.Transceive()

}

func (s *SearchCycle) Search(m *Worldmap.WorldMap) {
	for range int(3) {
		pulse(s)
		fmt.Println("Pulse sent" + s.Radar.PulseDirection.String())
		s.Radar.UpdatePulseDirection()
	}
}
