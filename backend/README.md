# Matiks Leaderboard Backend

In-memory leaderboard service built for correctness under scale. Rankings are tie-aware, updates are continuous, and read paths stay fast even as user counts grow.

## Overview

- Ratings range from 100 to 5000 (inclusive).
- Ranking rule: users with the same rating share the same rank.
- Rank = 1 + number of users with a higher rating.
- Updates are simulated in the background and do not block reads.
- Leaderboard responses are served from a refreshed snapshot of all users.
- Search is case-insensitive prefix matching with live rank lookup and pagination.
- CORS is open (`*`) for easy deployment.

## Quick Start

```powershell
cd backend
go run .
```

The server listens on `http://localhost:8080` by default.

## Configuration

Environment variables:

- `PORT` (default `8080`)
- `SEED_USERS` (default `10000`, minimum enforced)
- `UPDATES_PER_TICK` (default `200`)
- `TICK_MS` (default `200`)
- `SNAPSHOT_MS` (default `1000`)

Notes:

- `SEED_USERS` is the base count. Extra demo users (Rahul variants) are added on top so search returns many matches.
- Snapshot refresh only affects leaderboard reads; search remains live.

## Endpoints

- `GET /leaderboard?limit=20&page=1` (max 200, paginated across all users)
- `GET /search?query=rahul&limit=20&page=1` (max 200, paginated)
- `GET /health`

## Response Examples

Leaderboard:

```json
{
  "updated_at": "2026-01-18T12:34:56Z",
  "total_users": 10210,
  "page": 1,
  "page_size": 20,
  "total_pages": 511,
  "entries": [
    { "rank": 1, "username": "rahul", "rating": 4600 }
  ]
}
```

Search:

```json
{
  "query": "rahul",
  "count": 4,
  "total": 210,
  "page": 1,
  "page_size": 20,
  "total_pages": 11,
  "results": [
    { "rank": 200, "username": "rahul", "rating": 4600 },
    { "rank": 800, "username": "rahul_burman", "rating": 3900 }
  ]
}
```

## Performance Notes

- Rank lookup is O(range) over 4901 rating buckets using atomic counters.
- Updates only lock small rating buckets for a moment; reads stay responsive.
- Leaderboard reads use a snapshot refreshed on a timer, so they are fast and non-blocking.
- Snapshot stores sorted user IDs (not full payloads) to keep memory usage reasonable.

## Troubleshooting

- If the frontend cannot connect, confirm the server is running and your device can reach the host and port.
- For mobile devices, use your machine LAN IP (e.g. `http://192.168.x.x:8080`).
