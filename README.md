# The Village

A continuous, navigable village for projects and sessions. Every project gets an open-front workshop, and every session gets a seat at its shared worktable. The first version uses sample sessions so the village is useful immediately, with a standalone data endpoint for real metadata.

## Run locally

Requires Node.js 20.19 or newer.

```sh
npm install
npm run dev
```

Open <http://127.0.0.1:5177>. The development command runs Vite and the local data server together. For a built version, run `npm start` and open <http://127.0.0.1:41321>. Everything runs from this repository. Set `VILLAGE_PORT` to change the local API port.

Drag to pan, scroll or pinch to zoom, click a building name to focus it, and click a seated character or their name for session details. The map buttons also zoom and fit all buildings. Keyboard shortcuts: `0` fits all, `+` and `-` zoom, and `Escape` closes the details panel.

## Supply session metadata

Set `VILLAGE_DATA_FILE` to an absolute JSON file path before starting the server. The server reads that file for each request to `GET /api/world`, validates the public fields, and the browser refreshes the snapshot every 15 seconds. A collector can replace the file atomically without restarting the app.

```sh
VILLAGE_DATA_FILE=/absolute/path/to/world.json npm run dev
```

The file format is:

```json
{
  "projects": [
    {
      "id": "project-id",
      "name": "Project name",
      "kind": "Workshop",
      "sessions": [
        {
          "id": "session-id",
          "name": "Session name",
          "updatedAt": "2026-10-12T12:00:00Z",
          "activity": "Latest observed activity",
          "status": "recent"
        }
      ]
    }
  ]
}
```

`updatedAt` may be `null`. `status` is `recent`, `quiet`, or `unknown`; it describes a supplied signal, not whether a Claude Code process is running. The `id` fields must be unique. The endpoint deliberately accepts only names, times, and short activity descriptions. Transcripts, prompts, tool inputs, and credentials are outside this UI contract.

The next integration can collect Claude Code session metadata and write this file, or implement a new source behind `server/worldSource.ts`. The world renderer and inspector consume the same `WorldSnapshot` either way. Opening or continuing a Claude Code conversation requires a separate supported action and is not part of this milestone. Cowork is not connected.

## Checks

```sh
npm test
npm run build
```

The initial camera and seated character concepts were adapted from the earlier Office prototype. The village layout, architecture, styling, data boundary, and interface are new to this repository.
