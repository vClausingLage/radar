package Vector

import (
	"math"
	"testing"
)

func TestNew(t *testing.T) {
	v := New(1, 2, 3)
	if v.X != 1 || v.Y != 2 || v.Z != 3 {
		t.Errorf("New(1, 2, 3) = %v; want {1, 2, 3}", v)
	}
}

func TestDistanceTo(t *testing.T) {
	v1 := New(1, 2, 3)
	v2 := New(4, 5, 6)
	expected := math.Sqrt(27)
	result := v1.DistanceTo(*v2)
	if result != expected {
		t.Errorf("v1.DistanceTo(v2) = %v; want %v", result, expected)
	}
}

func TestLength(t *testing.T) {
	v := New(1, 2, 2)
	expected := 3.0
	result := v.Length()
	if result != expected {
		t.Errorf("v.Length() = %v; want %v", result, expected)
	}
}

func TestNormalize(t *testing.T) {
	v := New(3, 0, 4)
	expected := New(0.6, 0, 0.8)
	result := v.Normalize()
	if result != *expected {
		t.Errorf("v.Normalize() = %v; want %v", result, expected)
	}
}

func TestAdd(t *testing.T) {
	v1 := New(1, 2, 3)
	v2 := New(4, 5, 6)
	expected := New(5, 7, 9)
	result := v1.Add(*v2)
	if result != *expected {
		t.Errorf("v1.Add(v2) = %v; want %v", result, expected)
	}
}

func TestScale(t *testing.T) {
	v := New(1, 2, 3)
	scalar := 2.0
	expected := New(2, 4, 6)
	result := v.Scale(scalar)
	if result != *expected {
		t.Errorf("v.Scale(scalar) = %v; want %v", result, expected)
	}
}
