import fs from 'fs'
import os from 'os'
import { join } from 'path'

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
export const QUEUE_FILE = join(JARVIS_DIR, 'telegram-queue.json')
export const APPROVALS_FILE = join(JARVIS_DIR, 'approvals.json')
export const TRIGGER_DIR = JARVIS_DIR
export const CRM_DB = join(JARVIS_DIR, 'crm.db')
export const KNOWLEDGE_DB = join(JARVIS_DIR, 'knowledge.db')
