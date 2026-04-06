// ── time.list_entries ─────────────────────────────────────────────────────────

export type TimeListEntriesInput = {
  start_date: string;
  end_date: string;
  project_id?: string;
};

export type TimeEntry = {
  id: string;
  description: string;
  project: string;
  start: string;
  stop: string;
  duration_seconds: number;
  tags: string[];
};

export type TimeListEntriesOutput = {
  entries: TimeEntry[];
  total_hours: number;
  period: string;
};

// ── time.create_entry ────────────────────────────────────────────────────────

export type TimeCreateEntryInput = {
  description: string;
  project_id?: string;
  start: string;
  duration_seconds: number;
  tags?: string[];
};

export type TimeCreateEntryOutput = {
  entry: TimeEntry;
  created: boolean;
};

// ── time.summary ─────────────────────────────────────────────────────────────

export type TimeSummaryInput = {
  start_date: string;
  end_date: string;
  group_by?: "project" | "day" | "tag";
};

export type TimeSummaryGroup = {
  key: string;
  total_hours: number;
  entry_count: number;
};

export type TimeSummaryOutput = {
  groups: TimeSummaryGroup[];
  total_hours: number;
  period: string;
};

// ── time.sync ────────────────────────────────────────────────────────────────

export type TimeSyncInput = {
  direction?: "pull" | "push" | "both";
};

export type TimeSyncOutput = {
  synced_entries: number;
  direction: string;
  synced_at: string;
};
