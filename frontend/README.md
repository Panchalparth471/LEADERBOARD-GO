# Matiks Leaderboard Frontend (Expo SDK 54)

React Native (Expo) client that displays the live leaderboard and supports instant user search with global ranks.

## Prerequisites

- Node.js 18+ recommended
- npm
- Expo CLI (via `npx expo`)

## Setup

```powershell
cd frontend
npm install
```

If you are running the backend locally on the same machine, set the API URL:

```powershell
$env:EXPO_PUBLIC_API_URL="http://localhost:8080"
```

Start the app:

```powershell
npm run start
```

## Running on Devices

- Android emulator uses `http://10.0.2.2:8080`.
- iOS simulator can use `http://localhost:8080`.
- Physical devices must use your machine LAN IP, for example:
  `http://192.168.1.10:8080`.

You can override the API endpoint via:

```
EXPO_PUBLIC_API_URL=http://your-ip:8080
```

## App Behavior

- Leaderboard is paginated (20 per page) across all users and refreshes every 5 seconds.
- Search is paginated (20 per page), debounced, and returns live rank + rating.
- Total user count is pulled from the backend and shown in the header.
- Requests time out after a few seconds; errors show the API URL to help debugging.

## SDK 54 Dependency Alignment

If npm reports version conflicts, align dependencies with SDK 54:

```powershell
npx expo install expo-blur expo-linear-gradient expo-font expo-status-bar
```

## Troubleshooting

- "Could not load leaderboard from ..." means the app cannot reach the backend.
  Confirm the backend is running and the device can reach the host/port.
- If you are on a physical device, `localhost` will not work. Use your machine IP.
- If the app keeps loading, restart the backend after updating it to the paginated endpoints.
