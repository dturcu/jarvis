import { Router } from 'express'
import { DatabaseSync } from 'node:sqlite'
import os from 'os'
import { join } from 'path'

function getDb() {
  return new DatabaseSync(join(os.homedir(), '.jarvis', 'crm.db'))
}

export const analyticsRouter = Router()

// GET /pipeline — stage distribution (count per stage)
analyticsRouter.get('/pipeline', (_req, res) => {
  try {
    const db = getDb()
    const rows = db.prepare(
      `SELECT stage, COUNT(*) as count FROM contacts GROUP BY stage ORDER BY
       CASE stage
         WHEN 'prospect' THEN 1
         WHEN 'qualified' THEN 2
         WHEN 'contacted' THEN 3
         WHEN 'meeting' THEN 4
         WHEN 'proposal' THEN 5
         WHEN 'negotiation' THEN 6
         WHEN 'won' THEN 7
         WHEN 'lost' THEN 8
         WHEN 'parked' THEN 9
         ELSE 10
       END`
    ).all() as Array<{ stage: string; count: number }>
    db.close()
    res.json(rows)
  } catch {
    res.json([])
  }
})

// GET /velocity — avg days per stage transition
analyticsRouter.get('/velocity', (_req, res) => {
  try {
    const db = getDb()
    // Compute next_moved_at using a subquery (next transition for same contact after this one)
    const rows = db.prepare(
      `SELECT
         sh.from_stage,
         sh.to_stage,
         ROUND(AVG(
           julianday(COALESCE(
             (SELECT MIN(sh2.moved_at) FROM stage_history sh2
              WHERE sh2.contact_id = sh.contact_id AND sh2.moved_at > sh.moved_at),
             datetime('now')
           )) - julianday(sh.moved_at)
         ), 1) as avg_days,
         COUNT(*) as transitions
       FROM stage_history sh
       GROUP BY sh.from_stage, sh.to_stage
       ORDER BY transitions DESC`
    ).all() as Array<{ from_stage: string; to_stage: string; avg_days: number; transitions: number }>
    db.close()
    res.json(rows)
  } catch {
    res.json([])
  }
})

// GET /activity — daily activity for last 90 days
analyticsRouter.get('/activity', (_req, res) => {
  try {
    const db = getDb()
    const rows = db.prepare(
      `SELECT date, SUM(count) as count FROM (
         SELECT date(created_at) as date, COUNT(*) as count
         FROM notes
         WHERE created_at >= date('now', '-90 days')
         GROUP BY date(created_at)
         UNION ALL
         SELECT date(moved_at) as date, COUNT(*) as count
         FROM stage_history
         WHERE moved_at >= date('now', '-90 days')
         GROUP BY date(moved_at)
       ) GROUP BY date ORDER BY date ASC`
    ).all() as Array<{ date: string; count: number }>
    db.close()
    res.json(rows)
  } catch {
    res.json([])
  }
})

// GET /scores — score distribution in buckets
analyticsRouter.get('/scores', (_req, res) => {
  try {
    const db = getDb()
    const rows = db.prepare(
      `SELECT
         CASE
           WHEN score <= 20 THEN '0-20'
           WHEN score <= 40 THEN '21-40'
           WHEN score <= 60 THEN '41-60'
           WHEN score <= 80 THEN '61-80'
           ELSE '81-100'
         END as bucket,
         COUNT(*) as count
       FROM contacts
       WHERE score IS NOT NULL
       GROUP BY bucket
       ORDER BY bucket`
    ).all() as Array<{ bucket: string; count: number }>
    db.close()
    // Ensure all buckets are present
    const buckets = ['0-20', '21-40', '41-60', '61-80', '81-100']
    const result = buckets.map(b => {
      const found = rows.find(r => r.bucket === b)
      return { bucket: b, count: found?.count ?? 0 }
    })
    res.json(result)
  } catch {
    res.json([])
  }
})
