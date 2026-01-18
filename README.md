# Matiks Leaderboard Platform

Backend (Golang) and frontend (Expo React Native) for a large-scale leaderboard with live updates, correct ties, and fast search.

## Backend

```powershell
cd backend
go run .
```

## Frontend

```powershell
cd frontend
npm install
$env:EXPO_PUBLIC_API_URL="http://localhost:8080"
npm run start
```

## Notes

- Leaderboard uses tie-correct ranking based on rating.
- Search is case-insensitive prefix search for fast, scalable lookups.
