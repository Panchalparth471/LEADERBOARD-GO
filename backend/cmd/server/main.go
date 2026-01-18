package main

import (
	"log"

	"matiks_app/backend"
)

func main() {
	if err := backend.StartServer(); err != nil {
		log.Fatal(err)
	}
}
