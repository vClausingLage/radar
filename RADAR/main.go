package main

import (
	"fmt"
	Vector "radar/vector"
)

func main() {
	v := Vector.New(1, 1, 0)
	w := Vector.New(1, 2, 0)
	fmt.Println(v.DistanceTo(w))
	fmt.Println(v)
}
