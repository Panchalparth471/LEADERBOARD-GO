package handler

import (
	"net/http"

	"matiks_app/backend/leaderboard"
)

func Handler(w http.ResponseWriter, r *http.Request) {
	leaderboard.Handler(w, r)
}
