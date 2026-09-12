# DevOps Labs Platform

## Local Development Setup

### 1. Database (PostgreSQL via Docker Compose)

Schema and seed data live in `db/init/*.sql` and are automatically applied
on the **first** startup of the Postgres container (via Postgres's
`docker-entrypoint-initdb.d` mechanism).

```bash
cd c:\myprojects\labs
docker compose up -d
```

This starts Postgres on `localhost:5432`:
- user: `labs`
- password: `labs`
- database: `labs`

To reset the database completely (re-run init scripts), remove the volume:

```bash
docker compose down -v
docker compose up -d
```

> Note: `db/init` scripts only run against a fresh (empty) data volume.
> For schema changes after initial setup, use a migration tool
> (e.g. `golang-migrate`) instead of editing these files.

### 2. Backend (Go)

```bash
cd backend
go mod tidy
go run ./cmd/server
```

Backend listens on `http://localhost:8080`. Set `DATABASE_URL` env var to
override the default connection string
(`postgres://labs:labs@localhost:5432/labs`).

### 3. Frontend (Angular)

```bash
cd frontend
npm install
npm start
```

Frontend runs on `http://localhost:4200` and calls the Go backend at
`http://localhost:8080/api/labs/:id`.
