# Minecode

A navigable, blocky world for Claude Code and Codex sessions. Claude's workshops and Codex's outposts face each other across a river. Sessions have places at shared worktables; characters type, take coffee breaks, and sometimes step outside. Sessions without a project gather in the Village Hall or Outpost Hall.

![Minecode in sample mode, showing both districts and their communal halls](docs/village-preview.jpg)

The world fills the browser viewport. Drag or use the arrow keys to pan, Shift-drag or right-drag to rotate and tilt, and scroll or pinch to zoom. Select a building name to focus it, and select a character to inspect its session. The map controls rotate, zoom, and fit the whole village. Keyboard shortcuts: arrow keys to pan, `0` to fit all, `Q` and `E` to rotate, and `Escape` to close the details panel. A coffee badge appears above a character while they take a sip.

## Try it

Requires Node.js 20.19 or newer.

```sh
npm install
VILLAGE_SOURCE=sample npm run dev
```

Open <http://127.0.0.1:5177>. Sample mode uses fictional session data and needs no telemetry dashboards. The development command starts Vite and Minecode's local API together. For a built version, run `npm start` and open <http://127.0.0.1:41321>.

## Use live sessions

Keep your Claude Code and Codex telemetry dashboards running, then start Minecode with `npm run dev` (without `VILLAGE_SOURCE=sample`). It reads their existing session APIs over loopback:

| Source | Read-only session API | Existing telemetry receiver |
| --- | --- | --- |
| Claude Code | `127.0.0.1:41300` | `127.0.0.1:4318` |
| Codex | `127.0.0.1:18765` | `127.0.0.1:18766` |

Minecode listens separately on `127.0.0.1:41321`; Vite uses `127.0.0.1:5177` during development. It does not bind to the dashboards' ports or change either agent's telemetry configuration. Override ports with `CLAUDE_DASHBOARD_PORT`, `CODEX_DASHBOARD_PORT`, or `VILLAGE_PORT` as needed.

The default view shows sessions observed in the last 48 hours. The time control offers 24 hours, 7 days, and 30 days, and the browser refreshes every 15 seconds. If one dashboard is unavailable, the other still appears. If both are unavailable, automatic mode shows the fictional sample world. Set `VILLAGE_SOURCE=telemetry` to require live data.

Claude's API provides project and session titles. Codex's API provides session IDs and activity; Minecode uses local Codex metadata when available to recover titles and project folders. Projectless Claude sessions gather in **Village Hall**. Codex's dated chat folders and sessions without project metadata gather in **Outpost Hall**. Recent activity is an observed signal, not proof that a session is still running.

### Local data boundary

The sample world and preview image contain fictional sessions; no live telemetry snapshots are tracked. At runtime, Minecode's local API sends only names, IDs, timestamps, and short generic activity labels to the browser; it does not return prompts, transcripts, tool inputs, or credentials. Names and IDs from your own sessions may still be private. Keep the live server and dashboard APIs on loopback, and use sample mode for screenshots or public demos.

## Use a standalone data file

Minecode can also read a JSON snapshot from an absolute path. `VILLAGE_DATA_FILE` takes precedence over automatic telemetry. The server validates its public fields on each `GET /api/world` request, so a collector can replace the file atomically without restarting the app.

```sh
VILLAGE_DATA_FILE=/absolute/path/to/world.json npm run dev
```

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
          "updatedAt": "2026-01-01T12:00:00Z",
          "activity": "Latest observed activity",
          "status": "recent"
        }
      ]
    }
  ]
}
```

`source` is `claude` or `codex` and places the building on its corresponding bank; omitting it defaults to `claude`. Use `kind: "Commons"` for a communal hall. `updatedAt` may be `null`. `status` is `recent`, `quiet`, or `unknown`; it describes a supplied signal, not whether a process is running. Project and session IDs must be unique.

## Development

```sh
npm test
npm run build
```

Opening or continuing an agent conversation from the world is future work. Cowork is not connected. The initial camera and seated character concepts were adapted from an earlier Office prototype; the village layout, architecture, styling, data boundary, and interface live in this standalone repository.
