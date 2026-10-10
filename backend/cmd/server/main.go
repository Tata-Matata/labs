package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	defaultDBConnectTimeout     = 10 * time.Second
	defaultDBStartupPingTimeout = 10 * time.Second
	defaultDBQueryTimeout       = 5 * time.Second
)

type Lab struct {
	ID           string `json:"id"`
	Title        string `json:"title"`
	Description  string `json:"description"`
	Instructions string `json:"instructions"`
}

type Server struct {
	db           *pgxpool.Pool
	queryTimeout time.Duration
}

func main() {
	dsn := os.Getenv("DB_URL")
	if strings.TrimSpace(dsn) == "" {
		log.Fatal("DB_URL is required")
	}

	connectTimeout := mustDurationFromEnv("DB_CONNECT_TIMEOUT", defaultDBConnectTimeout)
	startupPingTimeout := mustDurationFromEnv("DB_STARTUP_PING_TIMEOUT", defaultDBStartupPingTimeout)
	queryTimeout := mustDurationFromEnv("DB_QUERY_TIMEOUT", defaultDBQueryTimeout)

	// parse DB connection string and create POOL config
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		log.Fatalf("invalid DB_URL: %v", err)
	}

	// Whenever pgx tries to establish a PostgreSQL connection,
	// don't let that connection attempt take longer than specified here.
	// this applies to later connections too, not just the first connection in main().
	// because it is configured in the pgxpool.Config
	// BUT it limits how long pgx may spend opening a new PostgreSQL connection.
	// It does not put a deadline on Query, QueryRow, Exec, or Ping as whole operations.

	cfg.ConnConfig.ConnectTimeout = connectTimeout

	// Create DB pool with configuration

	// valid background context, since there is no http request context yet (r.Context())
	// The context allows the operation to be cancelled
	// if pool initialization takes too long or the context is cancelled.

	// doesn't necessarily prove that PostgreSQL is reachable right here.
	// creating the pool itself isn't necessarily equivalent to "establish all the connections right now.""
	pool, err := pgxpool.NewWithConfig(context.Background(), cfg)
	if err != nil {
		log.Fatalf("unable to create database pool: %v", err)
	}

	// we need extra defined timeout for ping because
	// pool config timeout defined above is only for opening a new PostgreSQL connection
	// it does not limit the ping operation itself
	pingCtx, cancel := context.WithTimeout(context.Background(), startupPingTimeout)
	defer cancel()

	// actual check for communication with DB via Ping
	// context defines how long to wait
	// if it takes longer than context timeout,
	// the context expires and the operation is cancelled.
	if err := pool.Ping(pingCtx); err != nil {
		pool.Close()
		log.Fatalf("unable to reach database: %v", err)
	}
	defer pool.Close()

	// server and API endpoints
	server := &Server{db: pool, queryTimeout: queryTimeout}

	// HTTP router between handlers
	mux := http.NewServeMux()
	mux.HandleFunc("/api/labs", server.listLabsHandler)
	mux.HandleFunc("/api/labs/", server.getLabHandler)
	mux.HandleFunc("/api/terminal/stream", terminalStreamHandler)

	//listen on all interfaces (0.0.0.0:8080)
	addr := ":8080"
	log.Printf("server listening on %s", addr)
	if err := http.ListenAndServe(addr, mux); err != nil {
		// not only logs the error but also terminates the process	(os.Exit(1))
		log.Fatal(err)
	}
}

func (s *Server) listLabsHandler(w http.ResponseWriter, r *http.Request) {
	// timeout for SQL query execution
	ctx, cancel := context.WithTimeout(r.Context(), s.queryTimeout)
	//release resources associated with the context's timer
	// as soon as you're done with the context.
	defer cancel()

	rows, err := s.db.Query(ctx,
		"SELECT id, title, description, instructions FROM labs ORDER BY id")

	//500 if DB not reachable
	if err != nil {
		http.Error(w, "failed to fetch labs", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	//read labs
	labs := []Lab{}

	//rows.Next() returns false if there isn't another row or if there is fatal error
	// this fatal error is handled after the iteration
	for rows.Next() {
		var lab Lab
		if err := rows.Scan(&lab.ID, &lab.Title, &lab.Description, &lab.Instructions); err != nil {
			http.Error(w, "failed to read labs", http.StatusInternalServerError)
			return
		}
		labs = append(labs, lab)
	}

	//500 = handling possible rows.Next() returning false on fatal error
	if err := rows.Err(); err != nil {
		http.Error(w, "failed to read labs", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(labs)

}

func (s *Server) getLabHandler(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/labs/")

	//If someone requests: GET /api/labs/ then there's no ID
	// return client error 400 Bad Request
	if id == "" {
		http.Error(w, "lab id required", http.StatusBadRequest)
		return
	}

	var lab Lab

	// timeout for SQL query execution
	ctx, cancel := context.WithTimeout(r.Context(), s.queryTimeout)
	defer cancel()

	//$1 means the first parameter that comes after the SQL statement --> id
	// against possible attack on query := "SELECT ... WHERE id = '" + id + "'"
	// where attacker could put some code instead of valid id
	err := s.db.QueryRow(ctx,
		"SELECT id, title, description, instructions FROM labs WHERE id = $1", id,
	).Scan(&lab.ID, &lab.Title, &lab.Description, &lab.Instructions)
	if err != nil {
		// 404 on lab not found
		if errors.Is(err, pgx.ErrNoRows) {
			http.Error(w, "lab not found", http.StatusNotFound)
			return
		}

		// 500 if DB not reachable
		http.Error(w, "failed to fetch lab", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(lab)
}

func mustDurationFromEnv(name string, fallback time.Duration) time.Duration {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback
	}

	duration, err := time.ParseDuration(value)
	if err != nil {
		log.Fatal(fmt.Errorf("invalid %s %q: %w", name, value, err))
	}

	return duration
}
