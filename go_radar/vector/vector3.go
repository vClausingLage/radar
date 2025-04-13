package Vector

import (
	"fmt"
	"math"
)

type Vector3 struct {
	X, Y, Z float64
}

func New(x, y, z float64) *Vector3 {
	return &Vector3{x, y, z}
}

func (v Vector3) DistanceTo(other Vector3) float64 {
	return math.Sqrt((v.X-other.X)*(v.X-other.X) + (v.Y-other.Y)*(v.Y-other.Y) + (v.Z-other.Z)*(v.Z-other.Z))
}

func (v Vector3) Length() float64 {
	return math.Sqrt(v.X*v.X + v.Y*v.Y + v.Z*v.Z)
}

func (v Vector3) Normalize() *Vector3 {
	length := v.Length()
	return &Vector3{v.X / length, v.Y / length, v.Z / length}
}

func (v Vector3) Add(other Vector3) *Vector3 {
	return &Vector3{v.X + other.X, v.Y + other.Y, v.Z + other.Z}
}

func (v Vector3) Scale(factor float64) *Vector3 {
	return &Vector3{v.X * factor, v.Y * factor, v.Z * factor}
}

func (v Vector3) String() string {
	return fmt.Sprintf("(%f, %f, %f)", v.X, v.Y, v.Z)
}

func (v Vector3) TurnDegrees(angle float64) *Vector3 {
	angle = angle * math.Pi / 180
	x := v.X*math.Cos(angle) - v.Y*math.Sin(angle)
	y := v.X*math.Sin(angle) + v.Y*math.Cos(angle)
	return &Vector3{x, y, v.Z}
}
