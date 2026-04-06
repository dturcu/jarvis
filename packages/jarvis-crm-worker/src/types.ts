export type PipelineStage =
  | "prospect"
  | "qualified"
  | "contacted"
  | "meeting"
  | "proposal"
  | "negotiation"
  | "won"
  | "lost"
  | "parked";

// ── crm.add_contact ───────────────────────────────────────────────────────────

export type CrmAddContactInput = {
  name: string;
  company: string;
  role?: string;
  email?: string;
  linkedin_url?: string;
  source?: string; // "linkedin_scrape" | "web_intel" | "referral" | "direct"
  tags?: string[];
  notes?: string;
  stage?: PipelineStage; // default "prospect"
};

export type ContactRecord = {
  contact_id: string;
  name: string;
  company: string;
  role?: string;
  email?: string;
  linkedin_url?: string;
  source?: string;
  tags: string[];
  stage: PipelineStage;
  score: number; // computed engagement score
  created_at: string;
  updated_at: string;
  last_contact_at?: string;
};

export type CrmAddContactOutput = {
  contact: ContactRecord;
};

// ── crm.update_contact ────────────────────────────────────────────────────────

export type CrmUpdateContactInput = {
  contact_id: string;
  name?: string;
  company?: string;
  role?: string;
  email?: string;
  tags?: string[];
  score?: number;
  last_contact_at?: string;
};

export type CrmUpdateContactOutput = {
  contact: ContactRecord;
  changes_applied: string[];
};

// ── crm.list_pipeline ─────────────────────────────────────────────────────────

export type CrmListPipelineInput = {
  stage?: PipelineStage;
  tags?: string[];
  min_score?: number;
  limit?: number;
};

export type CrmListPipelineOutput = {
  contacts: ContactRecord[];
  total_count: number;
  stage_counts: Record<PipelineStage, number>;
};

// ── crm.move_stage ────────────────────────────────────────────────────────────

export type CrmMoveStageInput = {
  contact_id: string;
  new_stage: PipelineStage;
  reason?: string;
};

export type CrmMoveStageOutput = {
  contact_id: string;
  previous_stage: PipelineStage;
  new_stage: PipelineStage;
  moved_at: string;
};

// ── crm.add_note ──────────────────────────────────────────────────────────────

export type CrmAddNoteInput = {
  contact_id: string;
  content: string;
  note_type?: "call" | "email" | "meeting" | "observation" | "proposal" | "general";
};

export type NoteRecord = {
  note_id: string;
  contact_id: string;
  content: string;
  note_type: string;
  created_at: string;
};

export type CrmAddNoteOutput = {
  note: NoteRecord;
};

// ── crm.search ────────────────────────────────────────────────────────────────

export type CrmSearchInput = {
  query: string;
  fields?: Array<"name" | "company" | "notes" | "tags">;
  stage?: PipelineStage;
};

export type CrmSearchOutput = {
  contacts: ContactRecord[];
  total_matches: number;
  query: string;
};

// ── crm.digest ────────────────────────────────────────────────────────────────

export type CrmDigestInput = {
  include_parked?: boolean;
  days_since_contact?: number; // flag contacts not touched in N days
};

export type CrmDigestOutput = {
  total_contacts: number;
  stage_distribution: Record<PipelineStage, number>;
  hot_leads: ContactRecord[]; // score > 70, stage = meeting|proposal|negotiation
  stale_contacts: ContactRecord[]; // no contact in N days
  recent_movements: {
    contact_id: string;
    name: string;
    from: PipelineStage;
    to: PipelineStage;
    moved_at: string;
  }[];
  digest_at: string;
};
