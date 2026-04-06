// ── email.search ─────────────────────────────────────────────────────────────

export type EmailSearchInput = {
  query: string;        // Gmail search syntax: "from:foo@bar.com subject:RFQ"
  max_results?: number; // default 20
  page_token?: string;
};

export type EmailMessage = {
  message_id: string;
  thread_id: string;
  subject: string;
  from: string;
  to: string[];
  date: string;
  snippet: string;
  has_attachments: boolean;
  labels: string[];
};

export type EmailSearchOutput = {
  messages: EmailMessage[];
  total_results: number;
  next_page_token?: string;
};

// ── email.read ────────────────────────────────────────────────────────────────

export type EmailReadInput = {
  message_id: string;
  include_raw?: boolean;
};

export type EmailAttachment = {
  filename: string;
  content_type: string;
  size_bytes: number;
};

export type EmailReadOutput = {
  message_id: string;
  thread_id: string;
  subject: string;
  from: string;
  to: string[];
  cc?: string[];
  date: string;
  body_text: string;
  body_html?: string;
  attachments: EmailAttachment[];
  labels: string[];
};

// ── email.draft ───────────────────────────────────────────────────────────────

export type EmailDraftInput = {
  to: string[];
  subject: string;
  body: string;
  cc?: string[];
  reply_to_message_id?: string;
};

export type EmailDraftOutput = {
  draft_id: string;
  message_id: string;
  thread_id?: string;
  created_at: string;
};

// ── email.send ────────────────────────────────────────────────────────────────

export type EmailSendInput = {
  draft_id?: string;           // send existing draft
  to?: string[];               // or compose inline
  subject?: string;
  body?: string;
  cc?: string[];
  reply_to_message_id?: string;
};

export type EmailSendOutput = {
  message_id: string;
  thread_id: string;
  sent_at: string;
};

// ── email.label ───────────────────────────────────────────────────────────────

export type EmailLabelAction = "add" | "remove";

export type EmailLabelInput = {
  message_id: string;
  action: EmailLabelAction;
  labels: string[];
};

export type EmailLabelOutput = {
  message_id: string;
  action: EmailLabelAction;
  labels_applied: string[];
  labels_removed: string[];
};

// ── email.list_threads ────────────────────────────────────────────────────────

export type EmailListThreadsInput = {
  query?: string;
  max_results?: number;
};

export type EmailThread = {
  thread_id: string;
  subject: string;
  snippet: string;
  message_count: number;
  last_message_date: string;
  participants: string[];
};

export type EmailListThreadsOutput = {
  threads: EmailThread[];
  total_results: number;
};
