package main

import (
	worldmap "radar/map"
	radar "radar/radar"
	search "radar/search"
	Vector "radar/vector"
)

func main() {
	m := worldmap.New(100)
	r := radar.New(*Vector.New(0, 0, 0), *Vector.New(1, 0, 0).Normalize())
	search := search.New(*r, *m)
	search.Search(m)
}
