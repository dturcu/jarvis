import fs from 'fs'
import os from 'os'
import { join } from 'path'
import { DatabaseSync } from 'node:sqlite'

export type JarvisConfig = {
  telegram: {
    bot_token: string
    chat_id: string
  }
}

export function loadConfig(): JarvisConfig | null {
  const configPath = join(os.homedir(), '.jarvis', 'config.json')
  if (!fs.existsSync(configPath)) return null
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8')) as JarvisConfig
  } catch {
    return null
  }
}

export const JARVIS_DIR = join(os.homedir(), '.jarvis')
export const RUNTIME_DB_PATH = join(JARVIS_DIR, 'runtime.db')
export const CRM_DB = join(JARVIS_DIR, 'crm.db')
export const KNOWLEDGE_DB = join(JARVIS_DIR, 'knowledge.db')

/**
 * Open the runtime database with WAL mode and busy timeout.
 * All telegram operations go through this single DB connection.
 */
export function openRuntimeDb(): DatabaseSync {
  const db = new DatabaseSync(RUNTIME_DB_PATH)
  db.exec("PRAGMA journal_mode = WAL;")
  db.exec("PRAGMA busy_timeout = 5000;")
  return db
}
