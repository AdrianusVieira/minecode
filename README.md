# The Village

A continuous, navigable world for projects and sessions. Claude Code projects occupy a warm village bank; Codex projects occupy an outpost across the river. Every project gets an open-front building, while sessions without a project gather in the Village Hall or Outpost Hall. Every session gets a seat at a shared worktable. The Village reads session summaries from the two local telemetry dashboards when they are available.

## Run locally

Requires Node.js 20.19 or newer.

```sh
npm install
npm run dev
```

Open <http://127.0.0.1:5177>. The development command runs Vite and the local data server together. For a built version, run `npm start` and open <http://127.0.0.1:41321>. Everything runs from this repository. Set `VILLAGE_PORT` to change the local API port.

Drag to pan, scroll or pinch to zoom, click a building name to focus it, and click a seated character or their name for session details. The map buttons also zoom and fit all buildings. Keyboard shortcuts: `0` fits all, `+` and `-` zoom, and `Escape` closes the details panel.

## Connect the local telemetry dashboards

Keep the Claude Code and Codex telemetry dashboards running as usual. The Village makes read-only HTTP requests to their session APIs, by default at `127.0.0.1:41300` and `127.0.0.1:18765`. The existing OTLP receivers remain on ports `4318` and `18766`; The Village does not listen on those ports or change either agent's telemetry configuration. The Village itself listens on port `41321` (and Vite on `5177` during development).

The world shows sessions observed in the last 48 hours by default. Choose 24 hours, 7 days, or 30 days from the small control at the top. The browser refreshes data every 15 seconds. If only one dashboard is available, that source still appears. If neither is available, automatic mode shows sample sessions. Set `VILLAGE_SOURCE=telemetry` to require live data or `VILLAGE_SOURCE=sample` to force the illustrative world. Override upstream ports with `CLAUDE_DASHBOARD_PORT` and `CODEX_DASHBOARD_PORT` if needed.

Claude's dashboard supplies project and session titles. Codex's telemetry API supplies session IDs and activity; The Village uses local Codex thread metadata when available to recover names and project folders. Claude sessions with no known project gather in **Village Hall**. Codex's dated folders under `Documents/Codex` belong to projectless chats; they and Codex sessions without a matching folder gather in **Outpost Hall**. Activity describes the latest observed signal and does not prove a session is still running. The Village only sends names, IDs, timestamps, and short generic activity labels to its browser. It does not return prompts, transcripts, or tool contents.

## Supply a standalone session file

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
      "source": "claude",
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

`source` is `claude` or `codex` and places the project on its corresponding bank. Omit it in an older file to default to `claude`. `updatedAt` may be `null`. `status` is `recent`, `quiet`, or `unknown`; it describes a supplied signal, not whether a process is running. The `id` fields must be unique. The endpoint deliberately accepts only names, times, and short activity descriptions. Transcripts, prompts, tool inputs, and credentials are outside this UI contract.

The file source takes precedence over automatic telemetry when `VILLAGE_DATA_FILE` is set. The world renderer and inspector consume the same `WorldSnapshot` for either source. Opening or continuing an agent conversation is a separate integration. Cowork is not connected.

## Checks

```sh
npm test
npm run build
```

The initial camera and seated character concepts were adapted from the earlier Office prototype. The village layout, architecture, styling, data boundary, and interface are new to this repository.
