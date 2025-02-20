package main

import (
	worldmap "radar/map"
	radar "radar/radar"
	search "radar/search"
	Vector "radar/vector"
)

func main() {
	world := worldmap.New(100)
	search := search.New(*radar.New(*Vector.New(0, 0, 0), *Vector.New(10, 0, 0)), *world)
	search.Search()
}
