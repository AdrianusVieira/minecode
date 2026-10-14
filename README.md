# Minecode

A navigable, blocky world for Claude Code and Codex sessions. Claude's workshops and Codex's outposts face each other across a river. Sessions have places at shared worktables. Each district has a farm and a cafeteria. Sessions without a project gather in the Village Hall or Outpost Hall.

![Minecode in sample mode, showing both districts and their communal halls](docs/village-preview.jpg)

The world fills the browser viewport. Drag or use the arrow keys to pan, Shift-drag or right-drag to rotate and tilt, and scroll or pinch to zoom. Select a building name to focus it, and select a character to inspect its session usage, prompts, and activity. A straight path from each bridge end reaches a paved landing with an outdoor telemetry board before branching toward the buildings. Select a board to open that agent's usage dashboard in a side panel. The Claude Code board also has an Accounts view. The dashboard, account, and session panels share a light/dark switch. On desktop, drag the panel's left edge to set its width from 50% to 80%; the width and theme are saved in the browser. While a live session panel is open, the camera follows its character in the visible map area. The village and panels offer 24 hours, 48 hours, 7, 30, and 90 days, all time, or a custom range of local calendar days. A panel opens with the village's selected range. Data refreshes every 15 seconds. The map controls rotate, zoom, and fit the whole village. Keyboard shortcuts: arrow keys to pan, `0` to fit all, `Q` and `E` to rotate, and `Escape` to close the details panel.

The territory has its own automatic 29-minute day/night cycle and four 43-minute seasons. These lengths shift their phases against the real 24-hour day, so the same local time does not always show the same light or season. Seasonal ground, foliage, crops, sky, and lighting change gradually. A character's hair greys and a beard grows with the session's observed token total. Characters sit while activity is observed; after three minutes without a new event, they leave for farm work, coffee at the cafeteria, or walks with fresh random destinations and dwell times. Daylight and season influence the activity weights; a character does not choose the same outing twice in a row. Roaming destinations are sampled continuously along the village paths. New activity sends them back to their desk. The activity feed is observational, so the three-minute rule is based on the latest received event, not process state.

Village appearance and behavior use a versioned `mulberry32-v1` simulation generator. A fresh 32-bit seed comes from browser crypto and remains in session storage across reloads. Visit `?newRun=1` to make a new seed; Minecode places it in the URL. Save that URL or use `?seed=NUMBER` to replay the same terrain, appearances, and per-character random draws. Live telemetry and elapsed time can still change which characters appear and when they act, so replaying the seed alone does not replay an entire live session timeline.

## Try it

Requires Node.js 20.19 or newer.

```sh
npm install
VILLAGE_SOURCE=sample npm run dev
```

Open <http://127.0.0.1:5177>. Sample mode uses fictional session data for the world; its telemetry boards show locally collected usage. The development command starts Vite and Minecode's API and telemetry receivers together. For a built version, run `npm start` and open <http://127.0.0.1:41321>.

## Use live sessions

Stop the two telemetry dashboard servers before starting Minecode, because Minecode takes over their OTLP ports. Start Minecode with `npm run dev` (without `VILLAGE_SOURCE=sample`). It receives and stores the same OTLP streams itself:

| Source | Minecode receiver |
| --- | --- |
| Claude Code | `http://127.0.0.1:4318/v1/metrics` and `/v1/logs` |
| Codex | `http://127.0.0.1:18766/v1/logs` |

The existing Claude Code and Codex exporter settings can keep those endpoints. Minecode stores data in Git-ignored `data/claude.sqlite3` and `data/codex.sqlite3`. On its first start, it imports history from the sibling dashboard databases if they exist. It does not need those repos afterward. Set `VILLAGE_DATA_DIR` to move its storage, `CLAUDE_OTLP_PORT` or `CODEX_OTLP_PORT` to change receiver ports, and `VILLAGE_PORT` to change the web port. All listeners bind to loopback. Vite uses `127.0.0.1:5177` during development.

The default view shows sessions observed in the last 48 hours. A custom range includes both chosen local dates; filtering uses each telemetry record's timestamp. A new store starts empty until its first OTLP event arrives. Use `VILLAGE_SOURCE=sample` for a fictional world.

Select **Exile this session** in a live character's panel to remove its Minecode telemetry and saved title. After confirmation, the character walks beyond the territory and disappears. The deletion marker persists across restarts, so later telemetry for that same ID is ignored. Exile does not delete the original Claude Code or Codex conversation; it cannot be undone in Minecode.

Codex emits some conversation IDs with only startup/completion signals and no recorded prompt, API request, or tool result. Minecode retains their events and token observations but omits these signal-only IDs from the village's session count and the dashboard's conversation count. The Codex timeline still includes their reported tokens and labels its count of all observed IDs.

Claude telemetry provides project IDs, and Minecode scans local Claude metadata for custom chat titles. Codex telemetry provides session IDs and activity; Minecode uses local Codex metadata when available to recover titles and project folders. Projectless Claude sessions gather in **Village Hall**. Codex's dated chat folders and sessions without project metadata gather in **Outpost Hall**. Recent activity is an observed signal, not proof that a session is still running.

### Local data boundary

The sample world and preview image contain fictional sessions; no live telemetry snapshots are tracked by Git. At runtime, Minecode's world API sends only names, IDs, timestamps, and short generic activity labels to the browser. The board API sends aggregated usage and Claude account totals. Selecting a character loads that session's usage, activity, and any locally sanitized prompt text that was received. The APIs do not return full transcripts, tool inputs, or credentials. The local databases contain received telemetry, including sanitized prompt text where available, so protect or delete them as you would the old dashboard databases. Names, IDs, account emails, prompts, and usage totals from your own sessions may still be private. Keep Minecode on loopback and use sample mode for public screenshots.

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
          "status": "recent",
          "tokens": 12000
        }
      ]
    }
  ]
}
```

`source` is `claude` or `codex` and places the building on its corresponding bank; omitting it defaults to `claude`. Use `kind: "Commons"` for a communal hall. `updatedAt` may be `null`. `status` is `recent`, `quiet`, or `unknown`; it describes a supplied signal, not whether a process is running. Optional `tokens` is a non-negative total for visual aging. Project and session IDs must be unique.

## Development

```sh
npm test
npm run build
```

Opening or continuing an agent conversation from the world is future work. Cowork is not connected. The initial camera and seated character concepts were adapted from an earlier Office prototype; the village layout, architecture, styling, data boundary, and interface live in this standalone repository.
