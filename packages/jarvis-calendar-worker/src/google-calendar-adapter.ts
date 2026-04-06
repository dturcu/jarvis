import { google } from "googleapis";
import type { calendar_v3 } from "googleapis";
import type { CalendarAdapter, CalendarExecutionOutcome } from "./adapter.js";
import { CalendarWorkerError } from "./adapter.js";
import type {
  CalendarListEventsInput,
  CalendarListEventsOutput,
  CalendarCreateEventInput,
  CalendarCreateEventOutput,
  CalendarUpdateEventInput,
  CalendarUpdateEventOutput,
  CalendarFindFreeInput,
  CalendarFindFreeOutput,
  CalendarBriefInput,
  CalendarBriefOutput,
  CalendarEvent,
  FreeSlot,
} from "./types.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function isRetryableCalendarError(error: unknown): boolean {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code: number }).code;
    return code === 429 || code === 500 || code === 503;
  }
  return false;
}

function toResponseStatus(
  status: string | undefined | null,
): "accepted" | "declined" | "tentative" | "needsAction" {
  switch (status) {
    case "accepted":
      return "accepted";
    case "declined":
      return "declined";
    case "tentative":
      return "tentative";
    default:
      return "needsAction";
  }
}

function toEventStatus(
  status: string | undefined | null,
): "confirmed" | "tentative" | "cancelled" {
  switch (status) {
    case "confirmed":
      return "confirmed";
    case "tentative":
      return "tentative";
    case "cancelled":
      return "cancelled";
    default:
      return "confirmed";
  }
}

function gcalEventToCalendarEvent(
  event: calendar_v3.Schema$Event,
  calendarId: string,
): CalendarEvent {
  const startDateTime = event.start?.dateTime ?? event.start?.date ?? "";
  const endDateTime = event.end?.dateTime ?? event.end?.date ?? "";
  const isAllDay = !event.start?.dateTime;

  const attendees = (event.attendees ?? []).map((a) => ({
    email: a.email ?? "",
    name: a.displayName ?? undefined,
    response: toResponseStatus(a.responseStatus),
  }));

  return {
    event_id: event.id ?? "",
    calendar_id: calendarId,
    title: event.summary ?? "(No title)",
    description: event.description ?? undefined,
    start: startDateTime,
    end: endDateTime,
    location: event.location ?? undefined,
    attendees,
    organizer: event.organizer?.email ?? "",
    status: toEventStatus(event.status),
    is_all_day: isAllDay,
  };
}

// ── GoogleCalendarAdapter ───────────────────────────────────────────────────

export type GoogleCalendarAdapterConfig = {
  client_id: string;
  client_secret: string;
  refresh_token: string;
};

export class GoogleCalendarAdapter implements CalendarAdapter {
  private readonly calendar: calendar_v3.Calendar;

  constructor(config: GoogleCalendarAdapterConfig) {
    const oauth2 = new google.auth.OAuth2(
      config.client_id,
      config.client_secret,
    );
    oauth2.setCredentials({ refresh_token: config.refresh_token });
    this.calendar = google.calendar({ version: "v3", auth: oauth2 });
  }

  // ── listEvents ─────────────────────────────────────────────────────────────

  async listEvents(
    input: CalendarListEventsInput,
  ): Promise<CalendarExecutionOutcome<CalendarListEventsOutput>> {
    try {
      const calendarId = input.calendar_id ?? "primary";
      const maxResults = input.max_results ?? 50;

      const params: calendar_v3.Params$Resource$Events$List = {
        calendarId,
        timeMin: input.start_date,
        timeMax: input.end_date,
        maxResults,
        singleEvents: true,
        orderBy: "startTime",
      };

      if (input.query) {
        params.q = input.query;
      }

      const response = await this.calendar.events.list(params);
      const items = response.data.items ?? [];

      const events = items.map((item) =>
        gcalEventToCalendarEvent(item, calendarId),
      );

      return {
        summary: `Found ${events.length} event(s) in calendar '${calendarId}' between ${input.start_date} and ${input.end_date}.`,
        structured_output: {
          events,
          total_count: events.length,
          calendar_id: calendarId,
        },
      };
    } catch (error) {
      throw this.wrapError("listEvents", error);
    }
  }

  // ── createEvent ────────────────────────────────────────────────────────────

  async createEvent(
    input: CalendarCreateEventInput,
  ): Promise<CalendarExecutionOutcome<CalendarCreateEventOutput>> {
    try {
      if (!input.title || !input.start || !input.end) {
        throw new CalendarWorkerError(
          "INVALID_INPUT",
          "createEvent requires title, start, and end.",
          false,
        );
      }

      const calendarId = input.calendar_id ?? "primary";

      const eventBody: calendar_v3.Schema$Event = {
        summary: input.title,
        start: { dateTime: input.start },
        end: { dateTime: input.end },
      };

      if (input.description) {
        eventBody.description = input.description;
      }
      if (input.location) {
        eventBody.location = input.location;
      }
      if (input.attendees && input.attendees.length > 0) {
        eventBody.attendees = input.attendees.map((email) => ({ email }));
      }

      const response = await this.calendar.events.insert({
        calendarId,
        requestBody: eventBody,
        sendUpdates: input.send_invites ? "all" : "none",
      });

      const created = response.data;
      const createdAt = created.created ?? new Date().toISOString();

      return {
        summary: `Created event '${input.title}' on ${input.start} in calendar '${calendarId}'.`,
        structured_output: {
          event_id: created.id ?? "",
          calendar_id: calendarId,
          title: input.title,
          start: input.start,
          end: input.end,
          created_at: createdAt,
        },
      };
    } catch (error) {
      if (error instanceof CalendarWorkerError) throw error;
      throw this.wrapError("createEvent", error);
    }
  }

  // ── updateEvent ────────────────────────────────────────────────────────────

  async updateEvent(
    input: CalendarUpdateEventInput,
  ): Promise<CalendarExecutionOutcome<CalendarUpdateEventOutput>> {
    try {
      const calendarId = input.calendar_id ?? "primary";

      const patchBody: calendar_v3.Schema$Event = {};
      const changesApplied: string[] = [];

      if (input.title !== undefined) {
        patchBody.summary = input.title;
        changesApplied.push("title");
      }
      if (input.start !== undefined) {
        patchBody.start = { dateTime: input.start };
        changesApplied.push("start");
      }
      if (input.end !== undefined) {
        patchBody.end = { dateTime: input.end };
        changesApplied.push("end");
      }
      if (input.description !== undefined) {
        patchBody.description = input.description;
        changesApplied.push("description");
      }
      if (input.location !== undefined) {
        patchBody.location = input.location;
        changesApplied.push("location");
      }

      await this.calendar.events.patch({
        calendarId,
        eventId: input.event_id,
        requestBody: patchBody,
        sendUpdates: input.send_updates ? "all" : "none",
      });

      const updatedAt = new Date().toISOString();

      return {
        summary: `Updated event '${input.event_id}': ${changesApplied.length > 0 ? changesApplied.join(", ") + " changed." : "no changes applied."}`,
        structured_output: {
          event_id: input.event_id,
          calendar_id: calendarId,
          updated_at: updatedAt,
          changes_applied: changesApplied,
        },
      };
    } catch (error) {
      if (this.isNotFoundError(error)) {
        throw new CalendarWorkerError(
          "EVENT_NOT_FOUND",
          `Event '${input.event_id}' not found in calendar '${input.calendar_id ?? "primary"}'.`,
          false,
          { event_id: input.event_id, calendar_id: input.calendar_id ?? "primary" },
        );
      }
      throw this.wrapError("updateEvent", error);
    }
  }

  // ── findFree ───────────────────────────────────────────────────────────────

  async findFree(
    input: CalendarFindFreeInput,
  ): Promise<CalendarExecutionOutcome<CalendarFindFreeOutput>> {
    try {
      const response = await this.calendar.freebusy.query({
        requestBody: {
          timeMin: input.start_search,
          timeMax: input.end_search,
          items: input.attendees.map((email) => ({ id: email })),
        },
      });

      const calendars = response.data.calendars ?? {};

      // Merge all busy intervals across attendees
      const busyIntervals: { start: number; end: number }[] = [];
      for (const calData of Object.values(calendars)) {
        for (const busy of calData.busy ?? []) {
          if (busy.start && busy.end) {
            busyIntervals.push({
              start: new Date(busy.start).getTime(),
              end: new Date(busy.end).getTime(),
            });
          }
        }
      }

      // Sort busy intervals by start time
      busyIntervals.sort((a, b) => a.start - b.start);

      // Merge overlapping intervals
      const merged: { start: number; end: number }[] = [];
      for (const interval of busyIntervals) {
        if (merged.length === 0 || merged[merged.length - 1]!.end < interval.start) {
          merged.push({ ...interval });
        } else {
          merged[merged.length - 1]!.end = Math.max(
            merged[merged.length - 1]!.end,
            interval.end,
          );
        }
      }

      // Find free slots between busy intervals
      const searchStartMs = new Date(input.start_search).getTime();
      const searchEndMs = new Date(input.end_search).getTime();
      const durationMs = input.duration_minutes * 60 * 1000;

      const slots: FreeSlot[] = [];
      let cursor = searchStartMs;

      for (const busy of merged) {
        if (busy.start > cursor) {
          const gapMs = busy.start - cursor;
          if (gapMs >= durationMs) {
            // Optionally filter to working hours
            if (!input.working_hours_only || this.isWorkingHours(cursor, busy.start)) {
              slots.push({
                start: new Date(cursor).toISOString(),
                end: new Date(busy.start).toISOString(),
                duration_minutes: Math.floor(gapMs / 60000),
              });
            }
          }
        }
        cursor = Math.max(cursor, busy.end);
      }

      // Check for free time after the last busy interval
      if (cursor < searchEndMs) {
        const gapMs = searchEndMs - cursor;
        if (gapMs >= durationMs) {
          if (!input.working_hours_only || this.isWorkingHours(cursor, searchEndMs)) {
            slots.push({
              start: new Date(cursor).toISOString(),
              end: new Date(searchEndMs).toISOString(),
              duration_minutes: Math.floor(gapMs / 60000),
            });
          }
        }
      }

      return {
        summary: `Found ${slots.length} free slot(s) for ${input.attendees.length} attendee(s) with ${input.duration_minutes}-minute minimum.`,
        structured_output: {
          slots,
          total_slots: slots.length,
          searched_attendees: input.attendees,
        },
      };
    } catch (error) {
      throw this.wrapError("findFree", error);
    }
  }

  // ── brief ──────────────────────────────────────────────────────────────────

  async brief(
    input: CalendarBriefInput,
  ): Promise<CalendarExecutionOutcome<CalendarBriefOutput>> {
    try {
      const calendarId = input.calendar_id ?? "primary";

      const response = await this.calendar.events.get({
        calendarId,
        eventId: input.event_id,
      });

      const event = response.data;
      if (!event) {
        throw new CalendarWorkerError(
          "EVENT_NOT_FOUND",
          `Event '${input.event_id}' not found -- cannot generate brief.`,
          false,
          { event_id: input.event_id },
        );
      }

      const title = event.summary ?? "(No title)";
      const start = event.start?.dateTime ?? event.start?.date ?? "";

      const attendees = (event.attendees ?? []).map((a) => ({
        email: a.email ?? "",
        name: a.displayName ?? undefined,
        company: this.inferCompanyFromEmail(a.email ?? ""),
      }));

      // Build meeting prep brief from event data
      const keyTopics: string[] = [];
      const recommendedAgenda: string[] = [];

      // Extract topics from description if available
      if (event.description) {
        keyTopics.push("Review meeting objectives per description");
      }
      keyTopics.push("Open action items from previous session");
      keyTopics.push("Timeline and deliverable milestones");

      // Build a reasonable agenda based on event duration
      const startMs = new Date(event.start?.dateTime ?? event.start?.date ?? "").getTime();
      const endMs = new Date(event.end?.dateTime ?? event.end?.date ?? "").getTime();
      const durationMinutes = Math.floor((endMs - startMs) / 60000);

      if (durationMinutes <= 30) {
        recommendedAgenda.push("5 min -- Introductions and scope recap");
        recommendedAgenda.push("15 min -- Review key items");
        recommendedAgenda.push("10 min -- Action items and next steps");
      } else if (durationMinutes <= 60) {
        recommendedAgenda.push("10 min -- Introductions and scope recap");
        recommendedAgenda.push("25 min -- Review open technical items");
        recommendedAgenda.push("15 min -- Action items and next steps");
      } else {
        recommendedAgenda.push("10 min -- Introductions and scope recap");
        recommendedAgenda.push(`${Math.floor(durationMinutes * 0.6)} min -- Deep-dive on open items`);
        recommendedAgenda.push("15 min -- Action items and next steps");
      }

      const contextNotes = `${title} is scheduled for ${start}.` +
        (event.location ? ` Location: ${event.location}.` : "") +
        ` ${attendees.length} attendee(s) invited.` +
        (event.description ? ` Description: ${event.description}` : "");

      // If history is requested, note that further CRM/email lookups would be needed
      const actionItems = input.include_history
        ? ["Follow up on open action items from prior interactions", "Review previous meeting notes"]
        : undefined;

      return {
        summary: `Generated meeting brief for '${title}' on ${start}.`,
        structured_output: {
          event_id: event.id ?? input.event_id,
          title,
          start,
          attendees,
          key_topics: keyTopics,
          recommended_agenda: recommendedAgenda,
          context_notes: contextNotes,
          action_items_from_last_meeting: actionItems,
        },
      };
    } catch (error) {
      if (error instanceof CalendarWorkerError) throw error;
      if (this.isNotFoundError(error)) {
        throw new CalendarWorkerError(
          "EVENT_NOT_FOUND",
          `Event '${input.event_id}' not found -- cannot generate brief.`,
          false,
          { event_id: input.event_id },
        );
      }
      throw this.wrapError("brief", error);
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private isNotFoundError(error: unknown): boolean {
    if (typeof error === "object" && error !== null && "code" in error) {
      return (error as { code: number }).code === 404;
    }
    return false;
  }

  private wrapError(operation: string, error: unknown): CalendarWorkerError {
    if (error instanceof CalendarWorkerError) return error;

    const retryable = isRetryableCalendarError(error);
    const message =
      error instanceof Error
        ? error.message
        : `Google Calendar API error during ${operation}.`;

    const details: Record<string, unknown> = { operation };
    if (typeof error === "object" && error !== null && "code" in error) {
      details["http_status"] = (error as { code: number }).code;
    }

    return new CalendarWorkerError(
      "CALENDAR_API_ERROR",
      message,
      retryable,
      details,
    );
  }

  private inferCompanyFromEmail(email: string): string | undefined {
    if (!email || !email.includes("@")) return undefined;
    const domain = email.split("@")[1]!.toLowerCase();

    // Skip common public email providers
    const publicDomains = new Set([
      "gmail.com", "yahoo.com", "outlook.com", "hotmail.com",
      "icloud.com", "protonmail.com", "jarvis.local",
    ]);
    if (publicDomains.has(domain)) return undefined;

    // Extract company name from domain
    const parts = domain.split(".");
    if (parts.length >= 2) {
      const companyPart = parts[parts.length - 2]!;
      // Capitalize first letter
      return companyPart.charAt(0).toUpperCase() + companyPart.slice(1);
    }
    return undefined;
  }

  private isWorkingHours(startMs: number, endMs: number): boolean {
    const start = new Date(startMs);
    const end = new Date(endMs);
    const startHour = start.getHours();
    const endHour = end.getHours();
    const startDay = start.getDay();

    // Working hours: Mon-Fri, 8:00-18:00
    if (startDay === 0 || startDay === 6) return false;
    return startHour >= 8 && endHour <= 18;
  }
}

export function createGoogleCalendarAdapter(
  config: GoogleCalendarAdapterConfig,
): CalendarAdapter {
  return new GoogleCalendarAdapter(config);
}
