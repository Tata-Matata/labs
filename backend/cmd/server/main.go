package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Lab struct {
	ID           string `json:"id"`
	Title        string `json:"title"`
	Description  string `json:"description"`
	Instructions string `json:"instructions"`
}

var dbPool *pgxpool.Pool

func main() {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://labs:labs@localhost:5432/labs"
	}

	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		log.Fatalf("unable to connect to database: %v", err)
	}
	defer pool.Close()
	dbPool = pool

	mux := http.NewServeMux()
	mux.HandleFunc("/api/labs", withCORS(listLabsHandler))
	mux.HandleFunc("/api/labs/", withCORS(getLabHandler))

	addr := ":8080"
	log.Printf("server listening on %s", addr)
	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatal(err)
	}
}

func withCORS(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "http://localhost:4200")
		w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next(w, r)
	}
}

func listLabsHandler(w http.ResponseWriter, r *http.Request) {
	rows, err := dbPool.Query(context.Background(),
		"SELECT id, title, description, instructions FROM labs ORDER BY id")
	if err != nil {
		http.Error(w, "failed to fetch labs", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	labs := []Lab{}
	for rows.Next() {
		var lab Lab
		if err := rows.Scan(&lab.ID, &lab.Title, &lab.Description, &lab.Instructions); err != nil {
			http.Error(w, "failed to read labs", http.StatusInternalServerError)
			return
		}
		labs = append(labs, lab)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(labs)
}

func getLabHandler(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/labs/")
	if id == "" {
		http.Error(w, "lab id required", http.StatusBadRequest)
		return
	}

	var lab Lab
	err := dbPool.QueryRow(context.Background(),
		"SELECT id, title, description, instructions FROM labs WHERE id = $1", id,
	).Scan(&lab.ID, &lab.Title, &lab.Description, &lab.Instructions)
	if err != nil {
		http.Error(w, "lab not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(lab)
}
