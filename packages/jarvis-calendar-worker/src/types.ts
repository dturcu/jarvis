// ── calendar.list_events ─────────────────────────────────────────────────────

export type CalendarListEventsInput = {
  calendar_id?: string;   // default "primary"
  start_date: string;     // ISO datetime
  end_date: string;       // ISO datetime
  max_results?: number;   // default 50
  query?: string;         // text search within events
};

export type CalendarEvent = {
  event_id: string;
  calendar_id: string;
  title: string;
  description?: string;
  start: string;          // ISO datetime
  end: string;
  location?: string;
  attendees: { email: string; name?: string; response?: "accepted" | "declined" | "tentative" | "needsAction" }[];
  organizer: string;
  status: "confirmed" | "tentative" | "cancelled";
  is_all_day: boolean;
};

export type CalendarListEventsOutput = {
  events: CalendarEvent[];
  total_count: number;
  calendar_id: string;
};

// ── calendar.create_event ─────────────────────────────────────────────────────

export type CalendarCreateEventInput = {
  title: string;
  start: string;
  end: string;
  description?: string;
  location?: string;
  attendees?: string[];
  calendar_id?: string;
  send_invites?: boolean;
};

export type CalendarCreateEventOutput = {
  event_id: string;
  calendar_id: string;
  title: string;
  start: string;
  end: string;
  created_at: string;
};

// ── calendar.update_event ─────────────────────────────────────────────────────

export type CalendarUpdateEventInput = {
  event_id: string;
  calendar_id?: string;
  title?: string;
  start?: string;
  end?: string;
  description?: string;
  location?: string;
  send_updates?: boolean;
};

export type CalendarUpdateEventOutput = {
  event_id: string;
  calendar_id: string;
  updated_at: string;
  changes_applied: string[];
};

// ── calendar.find_free ────────────────────────────────────────────────────────

export type CalendarFindFreeInput = {
  attendees: string[];        // email addresses
  duration_minutes: number;
  start_search: string;       // ISO datetime, start of search window
  end_search: string;         // ISO datetime, end of search window
  working_hours_only?: boolean;
};

export type FreeSlot = {
  start: string;
  end: string;
  duration_minutes: number;
};

export type CalendarFindFreeOutput = {
  slots: FreeSlot[];
  total_slots: number;
  searched_attendees: string[];
};

// ── calendar.brief ────────────────────────────────────────────────────────────

export type CalendarBriefInput = {
  event_id: string;
  calendar_id?: string;
  include_history?: boolean;  // include past interactions with attendees
};

export type CalendarBriefOutput = {
  event_id: string;
  title: string;
  start: string;
  attendees: { email: string; name?: string; company?: string }[];
  key_topics: string[];
  recommended_agenda: string[];
  context_notes: string;
  action_items_from_last_meeting?: string[];
};
