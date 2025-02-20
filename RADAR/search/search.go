package search

import (
	"fmt"
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

func (s *SearchCycle) Search() {
	signal := s.Radar.Transmit()
	fmt.Print(signal)
	for {
		signal.Move()
		if !s.WorldMap.Contains(signal) {
			break
		}
		time.Sleep(100 * time.Millisecond)
		// hit logic
		// miss logic

	}
}
