import { DatabaseSync } from "node:sqlite";

// ── Campaign types ───────────────────────────────────────────────────────────

export type Campaign = {
  id: string;
  name: string;
  type: "cold_outreach" | "nurture" | "re_engagement" | "client_update" | "event_followup";
  status: "draft" | "active" | "paused" | "completed";
  sequence_count: number;
  delay_days: number;
  subject_template: string;
  created_at: string;
  updated_at: string;
};

export type CampaignRecipientStatus =
  | "enrolled"
  | "sent"
  | "opened"
  | "replied"
  | "bounced"
  | "opted_out"
  | "completed";

export type CampaignRecipient = {
  campaign_id: string;
  contact_id: string;
  email: string;
  current_step: number;
  status: CampaignRecipientStatus;
  enrolled_at: string;
  last_sent_at: string | null;
  last_status_at: string;
};

// ── CampaignStore ────────────────────────────────────────────────────────────

export class CampaignStore {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS campaigns (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'cold_outreach',
        status TEXT NOT NULL DEFAULT 'draft',
        sequence_count INTEGER NOT NULL DEFAULT 3,
        delay_days INTEGER NOT NULL DEFAULT 4,
        subject_template TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS campaign_recipients (
        campaign_id TEXT NOT NULL,
        contact_id TEXT NOT NULL,
        email TEXT NOT NULL,
        current_step INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'enrolled',
        enrolled_at TEXT NOT NULL,
        last_sent_at TEXT,
        last_status_at TEXT NOT NULL,
        PRIMARY KEY (campaign_id, contact_id),
        FOREIGN KEY (campaign_id) REFERENCES campaigns(id)
      )
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_recipients_campaign ON campaign_recipients(campaign_id)
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_recipients_status ON campaign_recipients(status)
    `);
  }

  // ── Campaign CRUD ──────────────────────────────────────────────────────────

  createCampaign(params: {
    id: string;
    name: string;
    type: Campaign["type"];
    sequence_count: number;
    delay_days: number;
    subject_template: string;
  }): Campaign {
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO campaigns (id, name, type, status, sequence_count, delay_days, subject_template, created_at, updated_at)
      VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?)
    `);

    stmt.run(
      params.id,
      params.name,
      params.type,
      params.sequence_count,
      params.delay_days,
      params.subject_template,
      now,
      now,
    );

    return {
      id: params.id,
      name: params.name,
      type: params.type,
      status: "draft",
      sequence_count: params.sequence_count,
      delay_days: params.delay_days,
      subject_template: params.subject_template,
      created_at: now,
      updated_at: now,
    };
  }

  getCampaign(id: string): Campaign | null {
    const stmt = this.db.prepare("SELECT * FROM campaigns WHERE id = ?");
    const row = stmt.get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return rowToCampaign(row);
  }

  listCampaigns(): Campaign[] {
    const stmt = this.db.prepare("SELECT * FROM campaigns ORDER BY created_at DESC");
    const rows = stmt.all() as Array<Record<string, unknown>>;
    return rows.map(rowToCampaign);
  }

  updateCampaignStatus(id: string, status: Campaign["status"]): void {
    const now = new Date().toISOString();
    const stmt = this.db.prepare("UPDATE campaigns SET status = ?, updated_at = ? WHERE id = ?");
    stmt.run(status, now, id);
  }

  // ── Recipient management ───────────────────────────────────────────────────

  addRecipient(campaignId: string, contactId: string, email: string): void {
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO campaign_recipients (campaign_id, contact_id, email, current_step, status, enrolled_at, last_status_at)
      VALUES (?, ?, ?, 0, 'enrolled', ?, ?)
    `);

    stmt.run(campaignId, contactId, email, now, now);
  }

  updateRecipientStatus(
    campaignId: string,
    contactId: string,
    step: number,
    status: CampaignRecipientStatus,
  ): void {
    const now = new Date().toISOString();
    const lastSentAt = status === "sent" ? now : undefined;

    if (lastSentAt) {
      const stmt = this.db.prepare(`
        UPDATE campaign_recipients
        SET current_step = ?, status = ?, last_sent_at = ?, last_status_at = ?
        WHERE campaign_id = ? AND contact_id = ?
      `);
      stmt.run(step, status, lastSentAt, now, campaignId, contactId);
    } else {
      const stmt = this.db.prepare(`
        UPDATE campaign_recipients
        SET current_step = ?, status = ?, last_status_at = ?
        WHERE campaign_id = ? AND contact_id = ?
      `);
      stmt.run(step, status, now, campaignId, contactId);
    }
  }

  getRecipients(campaignId: string): CampaignRecipient[] {
    const stmt = this.db.prepare(
      "SELECT * FROM campaign_recipients WHERE campaign_id = ? ORDER BY enrolled_at",
    );
    const rows = stmt.all(campaignId) as Array<Record<string, unknown>>;
    return rows.map(rowToRecipient);
  }

  getRecipientsByStatus(campaignId: string, status: CampaignRecipientStatus): CampaignRecipient[] {
    const stmt = this.db.prepare(
      "SELECT * FROM campaign_recipients WHERE campaign_id = ? AND status = ? ORDER BY enrolled_at",
    );
    const rows = stmt.all(campaignId, status) as Array<Record<string, unknown>>;
    return rows.map(rowToRecipient);
  }

  close(): void {
    this.db.close();
  }
}

// ── Row mappers ──────────────────────────────────────────────────────────────

function rowToCampaign(row: Record<string, unknown>): Campaign {
  return {
    id: row.id as string,
    name: row.name as string,
    type: row.type as Campaign["type"],
    status: row.status as Campaign["status"],
    sequence_count: row.sequence_count as number,
    delay_days: row.delay_days as number,
    subject_template: row.subject_template as string,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

function rowToRecipient(row: Record<string, unknown>): CampaignRecipient {
  return {
    campaign_id: row.campaign_id as string,
    contact_id: row.contact_id as string,
    email: row.email as string,
    current_step: row.current_step as number,
    status: row.status as CampaignRecipientStatus,
    enrolled_at: row.enrolled_at as string,
    last_sent_at: (row.last_sent_at as string) ?? null,
    last_status_at: row.last_status_at as string,
  };
}
