package main

import (
	"log"

	"matiks_app/backend/leaderboard"
)

func main() {
	if err := leaderboard.StartServer(); err != nil {
		log.Fatal(err)
	}
}
