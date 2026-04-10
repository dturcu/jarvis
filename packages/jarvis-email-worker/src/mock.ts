import { EmailWorkerError, type EmailAdapter, type ExecutionOutcome } from "./adapter.js";
import type {
  EmailAttachment,
  EmailDraftInput,
  EmailDraftOutput,
  EmailLabelInput,
  EmailLabelOutput,
  EmailListThreadsInput,
  EmailListThreadsOutput,
  EmailMessage,
  EmailReadInput,
  EmailReadOutput,
  EmailSearchInput,
  EmailSearchOutput,
  EmailSendInput,
  EmailSendOutput,
  EmailThread
} from "./types.js";

const MOCK_NOW = "2026-04-04T12:00:00.000Z";

type DraftRecord = {
  draft_id: string;
  message_id: string;
  thread_id?: string;
  to: string[];
  subject: string;
  body: string;
  cc?: string[];
  created_at: string;
};

type SentRecord = {
  message_id: string;
  thread_id: string;
  sent_at: string;
};

const MOCK_INBOX: EmailMessage[] = [
  {
    message_id: "msg-001",
    thread_id: "thread-001",
    subject: "Re: AUTOSAR migration scope — updated timeline",
    from: "jan.krause@tier1.example.com",
    to: ["consulting@example-consulting.com"],
    date: "2026-04-03T09:14:00.000Z",
    snippet: "Following up on the AUTOSAR Classic to Adaptive migration. Can we schedule a call this week?",
    has_attachments: false,
    labels: ["INBOX", "UNREAD"]
  },
  {
    message_id: "msg-002",
    thread_id: "thread-002",
    subject: "RFQ: ISO 26262 safety analysis — brake controller ECU",
    from: "procurement@example-automotech.com",
    to: ["consulting@example-consulting.com"],
    date: "2026-04-03T11:30:00.000Z",
    snippet: "We require a ASIL-D compliant safety analysis for our next-generation brake controller ECU.",
    has_attachments: true,
    labels: ["INBOX", "IMPORTANT"]
  },
  {
    message_id: "msg-003",
    thread_id: "thread-003",
    subject: "SOTIF workshop — speaker confirmation needed",
    from: "events@automotive-safety-summit.org",
    to: ["consulting@example-consulting.com"],
    date: "2026-04-02T14:22:00.000Z",
    snippet: "Please confirm your participation as a keynote speaker at the SOTIF & ISO 21448 workshop.",
    has_attachments: false,
    labels: ["INBOX"]
  },
  {
    message_id: "msg-004",
    thread_id: "thread-001",
    subject: "Re: AUTOSAR migration scope — initial assessment",
    from: "consulting@example-consulting.com",
    to: ["jan.krause@tier1.example.com"],
    date: "2026-04-02T16:05:00.000Z",
    snippet: "Thank you for the project brief. Our initial assessment suggests a 6-month engagement.",
    has_attachments: true,
    labels: ["SENT"]
  },
  {
    message_id: "msg-005",
    thread_id: "thread-004",
    subject: "Functional safety audit — Q2 schedule",
    from: "auditor@certify-automotive.eu",
    to: ["consulting@example-consulting.com"],
    date: "2026-04-01T08:45:00.000Z",
    snippet: "Please provide your availability for the Q2 functional safety audit of your ISO 26262 processes.",
    has_attachments: false,
    labels: ["INBOX", "STARRED"]
  }
];

const MOCK_BODY_TEXT: Record<string, string> = {
  "msg-001": `Hans,\n\nFollowing up on the AUTOSAR Classic to Adaptive migration scope we discussed last month.\n\nWe have updated the timeline and would like to schedule a technical deep-dive call this week to align on the ARXML migration toolchain and the impact on the MCAL layer.\n\nPlease let me know your availability.\n\nBest regards,\nJan Krause\nTier-1 Supplier GmbH`,
  "msg-002": `Dear Consulting Team,\n\nWe are issuing a Request for Quotation for an ISO 26262:2018 safety analysis engagement covering our next-generation brake controller ECU (ASIL-D target).\n\nScope:\n- Hazard Analysis and Risk Assessment (HARA)\n- Functional Safety Concept\n- System FMEA\n- Safety case documentation\n\nPlease find the technical specification attached.\n\nDeadline for quotation: 2026-04-15\n\nRegards,\nProcurement Team\nAutomoTech AG`,
  "msg-003": `Dear Speaker,\n\nWe are pleased to confirm your provisional slot at the SOTIF & ISO 21448 Workshop (June 2026).\n\nPlease confirm your participation by replying to this email before 2026-04-10.\n\nKind regards,\nConference Secretariat`,
  "msg-004": `Hans,\n\nThank you for sharing the AUTOSAR migration project brief. Our initial assessment suggests a 6-month engagement with the following phases:\n\n1. Current state analysis (4 weeks)\n2. Migration planning and toolchain setup (6 weeks)\n3. Incremental migration of BSW modules (12 weeks)\n4. Integration testing and validation (6 weeks)\n\nPlease find our preliminary proposal attached.\n\nBest regards,\nJarvis Safety Consulting`,
  "msg-005": `Dear Consultant,\n\nThis is a reminder that your ISO 26262 process audit is scheduled for Q2 2026.\n\nPlease provide your availability for a 3-day on-site audit between 2026-05-12 and 2026-05-30.\n\nRequired documentation to prepare:\n- Safety management plan\n- Process evidence packages\n- Previous audit findings and corrective actions\n\nBest regards,\nLead Auditor\nCertify Automotive EU`
};

const MOCK_ATTACHMENTS: Record<string, EmailAttachment[]> = {
  "msg-002": [
    { filename: "brake_ecu_technical_spec_v2.pdf", content_type: "application/pdf", size_bytes: 2457600 },
    { filename: "rfq_form_Q2-2026.docx", content_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size_bytes: 184320 }
  ],
  "msg-004": [
    { filename: "autosar_migration_proposal_draft.pdf", content_type: "application/pdf", size_bytes: 1228800 }
  ]
};

export class MockEmailAdapter implements EmailAdapter {
  private inbox: EmailMessage[] = MOCK_INBOX.map((m) => ({ ...m, labels: [...m.labels] }));
  private drafts: Map<string, DraftRecord> = new Map();
  private labels: Map<string, string[]> = new Map(
    MOCK_INBOX.map((m) => [m.message_id, [...m.labels]])
  );
  private sent: SentRecord[] = [];
  private draftCounter = 0;
  private messageCounter = 100;

  // ── Inspection helpers ──────────────────────────────────────────────────────

  getDraftCount(): number {
    return this.drafts.size;
  }

  getLabels(messageId: string): string[] {
    return [...(this.labels.get(messageId) ?? [])];
  }

  getSentCount(): number {
    return this.sent.length;
  }

  // ── search ──────────────────────────────────────────────────────────────────

  async search(input: EmailSearchInput): Promise<ExecutionOutcome<EmailSearchOutput>> {
    const maxResults = input.max_results ?? 20;
    const query = input.query.toLowerCase();

    let filtered = this.inbox.filter((msg) => {
      if (!query || query === "*") return true;

      // Parse simple Gmail-style query tokens
      const tokens = query.split(/\s+/);
      return tokens.every((token) => {
        if (token.startsWith("from:")) {
          const val = token.slice(5);
          return msg.from.toLowerCase().includes(val);
        }
        if (token.startsWith("subject:")) {
          const val = token.slice(8);
          return msg.subject.toLowerCase().includes(val);
        }
        if (token.startsWith("to:")) {
          const val = token.slice(3);
          return msg.to.some((t) => t.toLowerCase().includes(val));
        }
        if (token.startsWith("label:")) {
          const val = token.slice(6).toUpperCase();
          const msgLabels = this.labels.get(msg.message_id) ?? msg.labels;
          return msgLabels.includes(val);
        }
        // Free text: match against subject or snippet
        return (
          msg.subject.toLowerCase().includes(token) ||
          msg.snippet.toLowerCase().includes(token) ||
          msg.from.toLowerCase().includes(token)
        );
      });
    });

    // Apply current label state
    filtered = filtered.map((msg) => ({
      ...msg,
      labels: this.labels.get(msg.message_id) ?? msg.labels
    }));

    const total = filtered.length;
    const page = filtered.slice(0, maxResults);

    return {
      summary: `Found ${total} message(s) matching query "${input.query}".`,
      structured_output: {
        messages: page,
        total_results: total,
        next_page_token: total > maxResults ? `page-token-${maxResults}` : undefined
      }
    };
  }

  // ── read ────────────────────────────────────────────────────────────────────

  async read(input: EmailReadInput): Promise<ExecutionOutcome<EmailReadOutput>> {
    const msg = this.inbox.find((m) => m.message_id === input.message_id);
    if (!msg) {
      throw new EmailWorkerError(
        "EMAIL_NOT_FOUND",
        `Message ${input.message_id} not found.`,
        false,
        { message_id: input.message_id }
      );
    }

    const bodyText = MOCK_BODY_TEXT[msg.message_id] ?? `Body of message ${msg.message_id}.`;
    const attachments = MOCK_ATTACHMENTS[msg.message_id] ?? [];
    const currentLabels = this.labels.get(msg.message_id) ?? msg.labels;

    const output: EmailReadOutput = {
      message_id: msg.message_id,
      thread_id: msg.thread_id,
      subject: msg.subject,
      from: msg.from,
      to: [...msg.to],
      date: msg.date,
      body_text: bodyText,
      attachments: [...attachments],
      labels: [...currentLabels]
    };

    return {
      summary: `Read message "${msg.subject}" from ${msg.from}.`,
      structured_output: output
    };
  }

  // ── draft ───────────────────────────────────────────────────────────────────

  async draft(input: EmailDraftInput): Promise<ExecutionOutcome<EmailDraftOutput>> {
    this.draftCounter += 1;
    this.messageCounter += 1;

    const draftId = `draft-${String(this.draftCounter).padStart(4, "0")}`;
    const messageId = `msg-draft-${String(this.messageCounter).padStart(4, "0")}`;

    let threadId: string | undefined;
    if (input.reply_to_message_id) {
      const original = this.inbox.find((m) => m.message_id === input.reply_to_message_id);
      threadId = original?.thread_id;
    }

    const record: DraftRecord = {
      draft_id: draftId,
      message_id: messageId,
      thread_id: threadId,
      to: [...input.to],
      subject: input.subject,
      body: input.body,
      cc: input.cc ? [...input.cc] : undefined,
      created_at: MOCK_NOW
    };

    this.drafts.set(draftId, record);

    return {
      summary: `Created draft "${input.subject}" to ${input.to.join(", ")}.`,
      structured_output: {
        draft_id: draftId,
        message_id: messageId,
        thread_id: threadId,
        created_at: MOCK_NOW
      }
    };
  }

  // ── send ────────────────────────────────────────────────────────────────────

  async send(input: EmailSendInput): Promise<ExecutionOutcome<EmailSendOutput>> {
    this.messageCounter += 1;
    const newMessageId = `msg-sent-${String(this.messageCounter).padStart(4, "0")}`;

    if (input.draft_id) {
      const draftRecord = this.drafts.get(input.draft_id);
      if (!draftRecord) {
        throw new EmailWorkerError(
          "DRAFT_NOT_FOUND",
          `Draft ${input.draft_id} not found.`,
          false,
          { draft_id: input.draft_id }
        );
      }

      this.drafts.delete(input.draft_id);

      const threadId = draftRecord.thread_id ?? `thread-sent-${this.messageCounter}`;
      const sentRecord: SentRecord = {
        message_id: draftRecord.message_id,
        thread_id: threadId,
        sent_at: MOCK_NOW
      };
      this.sent.push(sentRecord);

      return {
        summary: `Sent email "${draftRecord.subject}" to ${draftRecord.to.join(", ")}.`,
        structured_output: {
          message_id: draftRecord.message_id,
          thread_id: threadId,
          sent_at: MOCK_NOW
        }
      };
    }

    // Inline compose
    if (!input.to || input.to.length === 0) {
      throw new EmailWorkerError(
        "INVALID_INPUT",
        "Either draft_id or to/subject/body must be provided.",
        false
      );
    }

    let threadId: string;
    if (input.reply_to_message_id) {
      const original = this.inbox.find((m) => m.message_id === input.reply_to_message_id);
      threadId = original?.thread_id ?? `thread-sent-${this.messageCounter}`;
    } else {
      threadId = `thread-sent-${this.messageCounter}`;
    }

    const sentRecord: SentRecord = {
      message_id: newMessageId,
      thread_id: threadId,
      sent_at: MOCK_NOW
    };
    this.sent.push(sentRecord);

    return {
      summary: `Sent email "${input.subject ?? "(no subject)"}" to ${input.to.join(", ")}.`,
      structured_output: {
        message_id: newMessageId,
        thread_id: threadId,
        sent_at: MOCK_NOW
      }
    };
  }

  // ── label ───────────────────────────────────────────────────────────────────

  async label(input: EmailLabelInput): Promise<ExecutionOutcome<EmailLabelOutput>> {
    const msg = this.inbox.find((m) => m.message_id === input.message_id);
    if (!msg) {
      throw new EmailWorkerError(
        "EMAIL_NOT_FOUND",
        `Message ${input.message_id} not found.`,
        false,
        { message_id: input.message_id }
      );
    }

    const current = this.labels.get(input.message_id) ?? [...msg.labels];
    let labelsApplied: string[] = [];
    let labelsRemoved: string[] = [];

    if (input.action === "add") {
      labelsApplied = input.labels.filter((l) => !current.includes(l));
      const updated = [...current, ...labelsApplied];
      this.labels.set(input.message_id, updated);
    } else {
      labelsRemoved = input.labels.filter((l) => current.includes(l));
      const updated = current.filter((l) => !input.labels.includes(l));
      this.labels.set(input.message_id, updated);
    }

    const actionDesc = input.action === "add"
      ? `Applied ${labelsApplied.length} label(s) to message ${input.message_id}.`
      : `Removed ${labelsRemoved.length} label(s) from message ${input.message_id}.`;

    return {
      summary: actionDesc,
      structured_output: {
        message_id: input.message_id,
        action: input.action,
        labels_applied: labelsApplied,
        labels_removed: labelsRemoved
      }
    };
  }

  // ── listThreads ─────────────────────────────────────────────────────────────

  async listThreads(input: EmailListThreadsInput): Promise<ExecutionOutcome<EmailListThreadsOutput>> {
    const maxResults = input.max_results ?? 20;
    const query = input.query?.toLowerCase() ?? "";

    let messages = this.inbox;

    if (query) {
      messages = messages.filter((msg) =>
        msg.subject.toLowerCase().includes(query) ||
        msg.snippet.toLowerCase().includes(query) ||
        msg.from.toLowerCase().includes(query)
      );
    }

    // Group by thread_id
    const threadMap = new Map<string, EmailMessage[]>();
    for (const msg of messages) {
      const existing = threadMap.get(msg.thread_id) ?? [];
      existing.push(msg);
      threadMap.set(msg.thread_id, existing);
    }

    const threads: EmailThread[] = [];
    for (const [threadId, msgs] of threadMap) {
      const sorted = [...msgs].sort((a, b) => b.date.localeCompare(a.date));
      const latest = sorted[0]!;
      const participants = [...new Set(msgs.flatMap((m) => [m.from, ...m.to]))];

      threads.push({
        thread_id: threadId,
        subject: latest.subject,
        snippet: latest.snippet,
        message_count: msgs.length,
        last_message_date: latest.date,
        participants
      });
    }

    // Sort by last message date descending
    threads.sort((a, b) => b.last_message_date.localeCompare(a.last_message_date));

    const total = threads.length;
    const page = threads.slice(0, maxResults);

    return {
      summary: `Found ${total} thread(s)${query ? ` matching "${input.query}"` : ""}.`,
      structured_output: {
        threads: page,
        total_results: total
      }
    };
  }
}

export function createMockEmailAdapter(): EmailAdapter {
  return new MockEmailAdapter();
}
