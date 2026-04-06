import { google } from "googleapis";
import type { gmail_v1 } from "googleapis";
import { EmailWorkerError, type EmailAdapter, type ExecutionOutcome } from "./adapter.js";
import type {
  EmailSearchInput,
  EmailSearchOutput,
  EmailReadInput,
  EmailReadOutput,
  EmailDraftInput,
  EmailDraftOutput,
  EmailSendInput,
  EmailSendOutput,
  EmailLabelInput,
  EmailLabelOutput,
  EmailListThreadsInput,
  EmailListThreadsOutput,
  EmailMessage,
  EmailAttachment,
  EmailThread
} from "./types.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function base64urlEncode(str: string): string {
  return Buffer.from(str, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64urlDecode(encoded: string): string {
  const padded = encoded.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(padded, "base64").toString("utf-8");
}

function buildRfc2822(
  to: string[],
  subject: string,
  body: string,
  cc?: string[],
  bcc?: string[],
  inReplyTo?: string,
): string {
  const lines: string[] = [];
  lines.push(`To: ${to.join(", ")}`);
  if (cc && cc.length > 0) {
    lines.push(`Cc: ${cc.join(", ")}`);
  }
  if (bcc && bcc.length > 0) {
    lines.push(`Bcc: ${bcc.join(", ")}`);
  }
  lines.push(`Subject: ${subject}`);
  lines.push("MIME-Version: 1.0");
  lines.push("Content-Type: text/plain; charset=UTF-8");
  if (inReplyTo) {
    lines.push(`In-Reply-To: ${inReplyTo}`);
    lines.push(`References: ${inReplyTo}`);
  }
  lines.push("");
  lines.push(body);
  return lines.join("\r\n");
}

type ParsedHeaders = {
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  date: string;
  messageId: string;
};

function parseHeaders(
  headers: gmail_v1.Schema$MessagePartHeader[] | undefined,
): ParsedHeaders {
  const result: ParsedHeaders = {
    from: "",
    to: [],
    cc: [],
    subject: "",
    date: "",
    messageId: "",
  };

  if (!headers) return result;

  for (const header of headers) {
    const name = header.name?.toLowerCase();
    const value = header.value ?? "";
    switch (name) {
      case "from":
        result.from = value;
        break;
      case "to":
        result.to = value.split(",").map((s) => s.trim()).filter(Boolean);
        break;
      case "cc":
        result.cc = value.split(",").map((s) => s.trim()).filter(Boolean);
        break;
      case "subject":
        result.subject = value;
        break;
      case "date":
        result.date = value;
        break;
      case "message-id":
        result.messageId = value;
        break;
    }
  }

  return result;
}

type DecodedBody = {
  text: string;
  html: string | undefined;
};

function decodeMimeBody(
  payload: gmail_v1.Schema$MessagePart | undefined,
): DecodedBody {
  const result: DecodedBody = { text: "", html: undefined };
  if (!payload) return result;

  // Single-part message
  if (payload.body?.data && payload.mimeType) {
    const decoded = base64urlDecode(payload.body.data);
    if (payload.mimeType === "text/plain") {
      result.text = decoded;
    } else if (payload.mimeType === "text/html") {
      result.html = decoded;
    }
    return result;
  }

  // Multipart message — recurse into parts
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === "text/plain" && part.body?.data && !result.text) {
        result.text = base64urlDecode(part.body.data);
      } else if (part.mimeType === "text/html" && part.body?.data && !result.html) {
        result.html = base64urlDecode(part.body.data);
      } else if (part.mimeType?.startsWith("multipart/")) {
        // Recurse for nested multipart
        const nested = decodeMimeBody(part);
        if (!result.text && nested.text) result.text = nested.text;
        if (!result.html && nested.html) result.html = nested.html;
      }
    }
  }

  return result;
}

function extractAttachments(
  payload: gmail_v1.Schema$MessagePart | undefined,
): EmailAttachment[] {
  const attachments: EmailAttachment[] = [];
  if (!payload) return attachments;

  if (payload.filename && payload.filename.length > 0 && payload.body) {
    attachments.push({
      filename: payload.filename,
      content_type: payload.mimeType ?? "application/octet-stream",
      size_bytes: payload.body.size ?? 0,
    });
  }

  if (payload.parts) {
    for (const part of payload.parts) {
      attachments.push(...extractAttachments(part));
    }
  }

  return attachments;
}

function toIsoDate(dateString: string): string {
  try {
    return new Date(dateString).toISOString();
  } catch {
    return dateString;
  }
}

function isRetryableGmailError(error: unknown): boolean {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code: number }).code;
    return code === 429 || code === 500 || code === 503;
  }
  return false;
}

// ── GmailAdapter ─────────────────────────────────────────────────────────────

export type GmailAdapterConfig = {
  client_id: string;
  client_secret: string;
  refresh_token: string;
};

export class GmailAdapter implements EmailAdapter {
  private readonly gmail: gmail_v1.Gmail;

  constructor(config: GmailAdapterConfig) {
    const oauth2 = new google.auth.OAuth2(
      config.client_id,
      config.client_secret,
    );
    oauth2.setCredentials({ refresh_token: config.refresh_token });
    this.gmail = google.gmail({ version: "v1", auth: oauth2 });
  }

  // ── search ──────────────────────────────────────────────────────────────────

  async search(input: EmailSearchInput): Promise<ExecutionOutcome<EmailSearchOutput>> {
    try {
      const maxResults = input.max_results ?? 20;

      const listResponse = await this.gmail.users.messages.list({
        userId: "me",
        q: input.query,
        maxResults,
        pageToken: input.page_token,
      });

      const messageRefs = listResponse.data.messages ?? [];
      const totalResults = listResponse.data.resultSizeEstimate ?? messageRefs.length;

      const messages: EmailMessage[] = [];

      for (const ref of messageRefs) {
        if (!ref.id) continue;

        const msg = await this.gmail.users.messages.get({
          userId: "me",
          id: ref.id,
          format: "metadata",
          metadataHeaders: ["From", "To", "Subject", "Date"],
        });

        const headers = parseHeaders(msg.data.payload?.headers);
        const hasAttachments = (msg.data.payload?.parts ?? []).some(
          (p) => p.filename && p.filename.length > 0,
        );

        messages.push({
          message_id: msg.data.id ?? ref.id,
          thread_id: msg.data.threadId ?? "",
          subject: headers.subject,
          from: headers.from,
          to: headers.to,
          date: toIsoDate(headers.date),
          snippet: msg.data.snippet ?? "",
          has_attachments: hasAttachments,
          labels: msg.data.labelIds ?? [],
        });
      }

      return {
        summary: `Found ${totalResults} message(s) matching query "${input.query}".`,
        structured_output: {
          messages,
          total_results: totalResults,
          next_page_token: listResponse.data.nextPageToken ?? undefined,
        },
      };
    } catch (error) {
      throw this.wrapError("search", error);
    }
  }

  // ── read ────────────────────────────────────────────────────────────────────

  async read(input: EmailReadInput): Promise<ExecutionOutcome<EmailReadOutput>> {
    try {
      const msg = await this.gmail.users.messages.get({
        userId: "me",
        id: input.message_id,
        format: "full",
      });

      const headers = parseHeaders(msg.data.payload?.headers);
      const body = decodeMimeBody(msg.data.payload);
      const attachments = extractAttachments(msg.data.payload);

      const output: EmailReadOutput = {
        message_id: msg.data.id ?? input.message_id,
        thread_id: msg.data.threadId ?? "",
        subject: headers.subject,
        from: headers.from,
        to: headers.to,
        cc: headers.cc.length > 0 ? headers.cc : undefined,
        date: toIsoDate(headers.date),
        body_text: body.text,
        body_html: body.html,
        attachments,
        labels: msg.data.labelIds ?? [],
      };

      return {
        summary: `Read message "${headers.subject}" from ${headers.from}.`,
        structured_output: output,
      };
    } catch (error) {
      if (this.isNotFoundError(error)) {
        throw new EmailWorkerError(
          "EMAIL_NOT_FOUND",
          `Message ${input.message_id} not found.`,
          false,
          { message_id: input.message_id },
        );
      }
      throw this.wrapError("read", error);
    }
  }

  // ── draft ───────────────────────────────────────────────────────────────────

  async draft(input: EmailDraftInput): Promise<ExecutionOutcome<EmailDraftOutput>> {
    try {
      let threadId: string | undefined;
      let inReplyTo: string | undefined;

      if (input.reply_to_message_id) {
        const original = await this.gmail.users.messages.get({
          userId: "me",
          id: input.reply_to_message_id,
          format: "metadata",
          metadataHeaders: ["Message-ID"],
        });
        threadId = original.data.threadId ?? undefined;
        const origHeaders = parseHeaders(original.data.payload?.headers);
        inReplyTo = origHeaders.messageId || undefined;
      }

      const raw = buildRfc2822(
        input.to,
        input.subject,
        input.body,
        input.cc,
        undefined,
        inReplyTo,
      );
      const encodedRaw = base64urlEncode(raw);

      const createParams: gmail_v1.Params$Resource$Users$Drafts$Create = {
        userId: "me",
        requestBody: {
          message: {
            raw: encodedRaw,
            threadId,
          },
        },
      };

      const draftResponse = await this.gmail.users.drafts.create(createParams);
      const draftData = draftResponse.data;

      return {
        summary: `Created draft "${input.subject}" to ${input.to.join(", ")}.`,
        structured_output: {
          draft_id: draftData.id ?? "",
          message_id: draftData.message?.id ?? "",
          thread_id: draftData.message?.threadId ?? threadId,
          created_at: new Date().toISOString(),
        },
      };
    } catch (error) {
      if (error instanceof EmailWorkerError) throw error;
      throw this.wrapError("draft", error);
    }
  }

  // ── send ────────────────────────────────────────────────────────────────────

  async send(input: EmailSendInput): Promise<ExecutionOutcome<EmailSendOutput>> {
    try {
      // Option 1: Send an existing draft
      if (input.draft_id) {
        const sendResponse = await this.gmail.users.drafts.send({
          userId: "me",
          requestBody: {
            id: input.draft_id,
          },
        });

        const sentMsg = sendResponse.data;
        const headers = parseHeaders(sentMsg.payload?.headers);

        return {
          summary: `Sent draft "${headers.subject}" to ${headers.to.join(", ")}.`,
          structured_output: {
            message_id: sentMsg.id ?? "",
            thread_id: sentMsg.threadId ?? "",
            sent_at: new Date().toISOString(),
          },
        };
      }

      // Option 2: Compose and send inline
      if (!input.to || input.to.length === 0) {
        throw new EmailWorkerError(
          "INVALID_INPUT",
          "Either draft_id or to/subject/body must be provided.",
          false,
        );
      }

      let threadId: string | undefined;
      let inReplyTo: string | undefined;

      if (input.reply_to_message_id) {
        const original = await this.gmail.users.messages.get({
          userId: "me",
          id: input.reply_to_message_id,
          format: "metadata",
          metadataHeaders: ["Message-ID"],
        });
        threadId = original.data.threadId ?? undefined;
        const origHeaders = parseHeaders(original.data.payload?.headers);
        inReplyTo = origHeaders.messageId || undefined;
      }

      const raw = buildRfc2822(
        input.to,
        input.subject ?? "",
        input.body ?? "",
        input.cc,
        undefined,
        inReplyTo,
      );
      const encodedRaw = base64urlEncode(raw);

      const sendResponse = await this.gmail.users.messages.send({
        userId: "me",
        requestBody: {
          raw: encodedRaw,
          threadId,
        },
      });

      const sentMsg = sendResponse.data;

      return {
        summary: `Sent email "${input.subject ?? "(no subject)"}" to ${input.to.join(", ")}.`,
        structured_output: {
          message_id: sentMsg.id ?? "",
          thread_id: sentMsg.threadId ?? "",
          sent_at: new Date().toISOString(),
        },
      };
    } catch (error) {
      if (error instanceof EmailWorkerError) throw error;
      if (this.isNotFoundError(error) && input.draft_id) {
        throw new EmailWorkerError(
          "DRAFT_NOT_FOUND",
          `Draft ${input.draft_id} not found.`,
          false,
          { draft_id: input.draft_id },
        );
      }
      throw this.wrapError("send", error);
    }
  }

  // ── label ───────────────────────────────────────────────────────────────────

  async label(input: EmailLabelInput): Promise<ExecutionOutcome<EmailLabelOutput>> {
    try {
      const modifyRequest: gmail_v1.Schema$ModifyMessageRequest = {};
      if (input.action === "add") {
        modifyRequest.addLabelIds = input.labels;
      } else {
        modifyRequest.removeLabelIds = input.labels;
      }

      await this.gmail.users.messages.modify({
        userId: "me",
        id: input.message_id,
        requestBody: modifyRequest,
      });

      const labelsApplied = input.action === "add" ? [...input.labels] : [];
      const labelsRemoved = input.action === "remove" ? [...input.labels] : [];

      const actionDesc =
        input.action === "add"
          ? `Applied ${labelsApplied.length} label(s) to message ${input.message_id}.`
          : `Removed ${labelsRemoved.length} label(s) from message ${input.message_id}.`;

      return {
        summary: actionDesc,
        structured_output: {
          message_id: input.message_id,
          action: input.action,
          labels_applied: labelsApplied,
          labels_removed: labelsRemoved,
        },
      };
    } catch (error) {
      if (this.isNotFoundError(error)) {
        throw new EmailWorkerError(
          "EMAIL_NOT_FOUND",
          `Message ${input.message_id} not found.`,
          false,
          { message_id: input.message_id },
        );
      }
      throw this.wrapError("label", error);
    }
  }

  // ── listThreads ─────────────────────────────────────────────────────────────

  async listThreads(input: EmailListThreadsInput): Promise<ExecutionOutcome<EmailListThreadsOutput>> {
    try {
      const maxResults = input.max_results ?? 20;

      const listResponse = await this.gmail.users.threads.list({
        userId: "me",
        q: input.query ?? undefined,
        maxResults,
      });

      const threadRefs = listResponse.data.threads ?? [];
      const totalResults = listResponse.data.resultSizeEstimate ?? threadRefs.length;

      const threads: EmailThread[] = [];

      for (const ref of threadRefs) {
        if (!ref.id) continue;

        const thread = await this.gmail.users.threads.get({
          userId: "me",
          id: ref.id,
          format: "metadata",
          metadataHeaders: ["From", "To", "Subject", "Date"],
        });

        const threadMessages = thread.data.messages ?? [];
        if (threadMessages.length === 0) continue;

        // Get the latest message for subject/snippet
        const latestMsg = threadMessages[threadMessages.length - 1]!;
        const latestHeaders = parseHeaders(latestMsg.payload?.headers);

        // Collect all participants
        const participantSet = new Set<string>();
        for (const tmsg of threadMessages) {
          const h = parseHeaders(tmsg.payload?.headers);
          if (h.from) participantSet.add(h.from);
          for (const addr of h.to) participantSet.add(addr);
        }

        threads.push({
          thread_id: thread.data.id ?? ref.id,
          subject: latestHeaders.subject,
          snippet: latestMsg.snippet ?? ref.snippet ?? "",
          message_count: threadMessages.length,
          last_message_date: toIsoDate(latestHeaders.date),
          participants: [...participantSet],
        });
      }

      return {
        summary: `Found ${totalResults} thread(s)${input.query ? ` matching "${input.query}"` : ""}.`,
        structured_output: {
          threads,
          total_results: totalResults,
        },
      };
    } catch (error) {
      throw this.wrapError("listThreads", error);
    }
  }

  // ── Error helpers ───────────────────────────────────────────────────────────

  private isNotFoundError(error: unknown): boolean {
    if (typeof error === "object" && error !== null && "code" in error) {
      return (error as { code: number }).code === 404;
    }
    return false;
  }

  private wrapError(operation: string, error: unknown): EmailWorkerError {
    if (error instanceof EmailWorkerError) return error;

    const retryable = isRetryableGmailError(error);
    const message =
      error instanceof Error
        ? error.message
        : `Gmail API error during ${operation}.`;

    const details: Record<string, unknown> = { operation };
    if (typeof error === "object" && error !== null && "code" in error) {
      details["http_status"] = (error as { code: number }).code;
    }

    return new EmailWorkerError(
      "GMAIL_API_ERROR",
      message,
      retryable,
      details,
    );
  }
}
