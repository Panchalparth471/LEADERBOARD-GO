package handler

import (
	"net/http"

	backend "matiks_app/backend"
)

func Handler(w http.ResponseWriter, r *http.Request) {
	backend.Handler(w, r)
}
