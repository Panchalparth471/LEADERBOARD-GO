//go:build dev

package main

import "log"

func main() {
	if err := StartServer(); err != nil {
		log.Fatal(err)
	}
}
