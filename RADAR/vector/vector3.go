package Vector

import "math"

type Vector3 struct {
	X, Y, Z float64
}

func New(x, y, z float64) Vector3 {
	return Vector3{x, y, z}
}

func (v Vector3) DistanceTo(other Vector3) float64 {
	return math.Sqrt((v.X-other.X)*(v.X-other.X) + (v.Y-other.Y)*(v.Y-other.Y) + (v.Z-other.Z)*(v.Z-other.Z))
}

func (v Vector3) Length() float64 {
	return math.Sqrt(v.X*v.X + v.Y*v.Y + v.Z*v.Z)
}

func (v Vector3) Normalize() Vector3 {
	length := v.Length()
	return Vector3{v.X / length, v.Y / length, v.Z / length}
}

func (v Vector3) Add(other Vector3) Vector3 {
	return Vector3{v.X + other.X, v.Y + other.Y, v.Z + other.Z}
}

func (v Vector3) Scale(scalar float64) Vector3 {
	return Vector3{v.X * scalar, v.Y * scalar, v.Z * scalar}
}
