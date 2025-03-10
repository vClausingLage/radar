package main

import (
	"fmt"
	"net"
	"net/http"
	worldmap "radar/map"
	"radar/radar"
	"radar/search"
	Vector "radar/vector"
)

func main() {
	m := worldmap.New(10)
	m.AddTarget(*Vector.New(1, 1, 0), *Vector.New(0, 1, 0).Normalize(), 1)
	m.AddTarget(*Vector.New(5, 0, 0), *Vector.New(5, 5, 0).Normalize(), 1)
	r := radar.New(*Vector.New(0, 0, 0), *Vector.New(1, 0, 0).Normalize(), 1)
	search := search.New(*r, *m)
	search.Search(m)

	go startHTTPServer()
	startSocketServer()
}

func handleRadar(w http.ResponseWriter, r *http.Request) {
	fmt.Fprintf(w, "Radar is running")
}

func startHTTPServer() {
	http.HandleFunc("/radar", handleRadar)
	http.ListenAndServe(":8080", nil)
}

func startSocketServer() {
	listener, err := net.Listen("tcp", ":9090")
	if err != nil {
		fmt.Println("Error starting TCP server:", err)
		return
	}
	defer listener.Close()

	for {
		conn, err := listener.Accept()
		if err != nil {
			fmt.Println("Error accepting connection:", err)
			continue
		}
		go handleConnection(conn)
	}
}

func handleConnection(conn net.Conn) {
	defer conn.Close()
	conn.Write([]byte("Radar socket server is running\n"))
}
