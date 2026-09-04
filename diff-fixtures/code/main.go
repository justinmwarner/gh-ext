package main

import "fmt"

type Review struct {
	ID    string
	State string
}

func main() {
	fmt.Println("review", Review{ID: "1", State: "PENDING"})
}
