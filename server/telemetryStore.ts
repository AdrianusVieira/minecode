import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import Database from 'better-sqlite3'
import { Store as ClaudeStore } from './collectors/claude/store.js'
import { TitleScanner } from './collectors/claude/titles.js'
import { Store as CodexStore } from './collectors/codex/store.js'

export type TelemetryStores = { claude: ClaudeStore; codex: CodexStore }

const legacyPaths = {
  claude: resolve(import.meta.dirname, '../../claude-code-telemetry-dashboard/data/telemetry.sqlite3'),
  codex: resolve(import.meta.dirname, '../../codex-telemetry-dashboard/data/telemetry.sqlite3'),
}

export async function importHistory(source: string, destination: string): Promise<void> {
  if (existsSync(destination) || !existsSync(source)) return
  mkdirSync(dirname(destination), { recursive: true })
  const staging = `${destination}.importing-${process.pid}`
  rmSync(staging, { force: true })
  const db = new Database(source, { readonly: true, fileMustExist: true })
  try {
    await db.backup(staging)
    renameSync(staging, destination)
    console.log(`Imported existing telemetry into ${destination}`)
  } finally {
    db.close()
    rmSync(staging, { force: true })
  }
}

export async function openTelemetryStores(dataDir = process.env.VILLAGE_DATA_DIR || join(import.meta.dirname, '..', 'data')): Promise<{ stores: TelemetryStores; stopTitles: () => void }> {
  const root = resolve(dataDir)
  const claudePath = join(root, 'claude.sqlite3')
  const codexPath = join(root, 'codex.sqlite3')
  await importHistory(legacyPaths.claude, claudePath)
  await importHistory(legacyPaths.codex, codexPath)
  const claude = new ClaudeStore(claudePath)
  let codex: CodexStore
  try { codex = new CodexStore(codexPath) }
  catch (error) { claude.close(); throw error }
  const scanner = new TitleScanner(claude, resolve(process.env.CLAUDE_HOME || join(homedir(), '.claude')))
  const scan = () => void scanner.scan().catch((error) => console.error('Claude title scan failed:', error))
  scan()
  const interval = setInterval(scan, 30_000)
  return { stores: { claude, codex }, stopTitles: () => clearInterval(interval) }
}
