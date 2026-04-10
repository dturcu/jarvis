import { randomUUID } from "node:crypto";
import type { CalendarExecutionOutcome, CalendarAdapter } from "./adapter.js";
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
  CalendarEvent
} from "./types.js";

export const MOCK_NOW = "2026-04-04T12:00:00.000Z";

const SEED_EVENTS: CalendarEvent[] = [
  {
    event_id: "evt-autosar-001",
    calendar_id: "primary",
    title: "AUTOSAR safety review with Nordic Auto",
    description: "Review AUTOSAR adaptive platform safety requirements for next model year ECU integration.",
    start: "2026-04-05T09:00:00.000Z",
    end: "2026-04-05T10:30:00.000Z",
    location: "Nordic Auto AB HQ, Gothenburg (Room 4B)",
    attendees: [
      { email: "e.johansson@nordic-auto.example.com", name: "Erik Johansson", response: "accepted" },
      { email: "m.lindgren@nordic-auto.example.com", name: "Maria Lindgren", response: "accepted" },
      { email: "consultant@jarvis.local", name: "Jarvis Consultant", response: "accepted" }
    ],
    organizer: "e.johansson@nordic-auto.example.com",
    status: "confirmed",
    is_all_day: false
  },
  {
    event_id: "evt-tier1-002",
    calendar_id: "primary",
    title: "Proposal presentation - Tier 1 supplier",
    description: "Present functional safety consulting proposal to Zentral Automotive GmbH powertrain division.",
    start: "2026-04-07T13:00:00.000Z",
    end: "2026-04-07T14:00:00.000Z",
    location: "Teams call",
    attendees: [
      { email: "f.hartmann@zentral-auto.example.com", name: "Felix Hartmann", response: "accepted" },
      { email: "n.schreiber@zentral-auto.example.com", name: "Nina Schreiber", response: "tentative" },
      { email: "consultant@jarvis.local", name: "Jarvis Consultant", response: "accepted" }
    ],
    organizer: "consultant@jarvis.local",
    status: "confirmed",
    is_all_day: false
  },
  {
    event_id: "evt-iso26262-003",
    calendar_id: "primary",
    title: "ISO 26262 evidence audit kick-off",
    description: "Kick-off meeting for the Part 4/Part 6 software evidence audit for the Apex Motors iX3 project.",
    start: "2026-04-08T10:00:00.000Z",
    end: "2026-04-08T12:00:00.000Z",
    location: "Apex Motors AG Munich, Petuelring 130",
    attendees: [
      { email: "a.richter@apex-motors.example.com", name: "Andreas Richter", response: "accepted" },
      { email: "c.werner@apex-motors.example.com", name: "Claudia Werner", response: "accepted" },
      { email: "k.tanaka@apex-motors.example.com", name: "Kenji Tanaka", response: "needsAction" },
      { email: "consultant@jarvis.local", name: "Jarvis Consultant", response: "accepted" }
    ],
    organizer: "a.richter@apex-motors.example.com",
    status: "confirmed",
    is_all_day: false
  },
  {
    event_id: "evt-fmea-004",
    calendar_id: "primary",
    title: "FMEA workshop - brake-by-wire system",
    description: "Facilitate design FMEA session for the next-generation brake-by-wire control unit.",
    start: "2026-04-09T08:30:00.000Z",
    end: "2026-04-09T16:30:00.000Z",
    location: "ZF Friedrichshafen, Engineering Centre",
    attendees: [
      { email: "k.müller@zf.com", name: "Klaus Müller", response: "accepted" },
      { email: "n.johansson@zf.com", name: "Nils Johansson", response: "accepted" },
      { email: "consultant@jarvis.local", name: "Jarvis Consultant", response: "accepted" }
    ],
    organizer: "consultant@jarvis.local",
    status: "confirmed",
    is_all_day: false
  },
  {
    event_id: "evt-training-005",
    calendar_id: "primary",
    title: "Functional safety training delivery - ASIL decomposition",
    description: "Full-day training module on ASIL decomposition and safety goal allocation for Sigma Components engineers.",
    start: "2026-04-11T09:00:00.000Z",
    end: "2026-04-11T17:00:00.000Z",
    location: "Sigma Components GmbH, Stuttgart",
    attendees: [
      { email: "r.fischer@bosch.com", name: "Roland Fischer", response: "accepted" },
      { email: "i.nowak@bosch.com", name: "Irena Nowak", response: "accepted" },
      { email: "c.dubois@bosch.com", name: "Claire Dubois", response: "accepted" },
      { email: "consultant@jarvis.local", name: "Jarvis Consultant", response: "accepted" }
    ],
    organizer: "consultant@jarvis.local",
    status: "confirmed",
    is_all_day: false
  }
];

export class MockCalendarAdapter implements CalendarAdapter {
  private events: Map<string, CalendarEvent>;
  private createdEventIds: string[] = [];

  constructor() {
    this.events = new Map(SEED_EVENTS.map((e) => [e.event_id, { ...e }]));
  }

  getEventCount(): number {
    return this.events.size;
  }

  getEvent(eventId: string): CalendarEvent | undefined {
    return this.events.get(eventId);
  }

  async listEvents(
    input: CalendarListEventsInput,
  ): Promise<CalendarExecutionOutcome<CalendarListEventsOutput>> {
    const calendarId = input.calendar_id ?? "primary";
    const startMs = new Date(input.start_date).getTime();
    const endMs = new Date(input.end_date).getTime();
    const maxResults = input.max_results ?? 50;

    let filtered = [...this.events.values()].filter((e) => {
      if (e.calendar_id !== calendarId) return false;
      const eventStart = new Date(e.start).getTime();
      const eventEnd = new Date(e.end).getTime();
      // overlaps the window
      return eventStart < endMs && eventEnd > startMs;
    });

    if (input.query) {
      const needle = input.query.toLowerCase();
      filtered = filtered.filter(
        (e) =>
          e.title.toLowerCase().includes(needle) ||
          (e.description ?? "").toLowerCase().includes(needle)
      );
    }

    filtered = filtered.slice(0, maxResults);

    return {
      summary: `Found ${filtered.length} event(s) in calendar '${calendarId}' between ${input.start_date} and ${input.end_date}.`,
      structured_output: {
        events: filtered,
        total_count: filtered.length,
        calendar_id: calendarId
      }
    };
  }

  async createEvent(
    input: CalendarCreateEventInput,
  ): Promise<CalendarExecutionOutcome<CalendarCreateEventOutput>> {
    if (!input.title || !input.start || !input.end) {
      throw new TypeError("createEvent requires title, start, and end.");
    }

    const eventId = `evt-created-${randomUUID().slice(0, 8)}`;
    const calendarId = input.calendar_id ?? "primary";
    const createdAt = MOCK_NOW;

    const newEvent: CalendarEvent = {
      event_id: eventId,
      calendar_id: calendarId,
      title: input.title,
      description: input.description,
      start: input.start,
      end: input.end,
      location: input.location,
      attendees: (input.attendees ?? []).map((email) => ({ email })),
      organizer: "consultant@jarvis.local",
      status: "confirmed",
      is_all_day: false
    };

    this.events.set(eventId, newEvent);
    this.createdEventIds.push(eventId);

    return {
      summary: `Created event '${input.title}' on ${input.start} in calendar '${calendarId}'.`,
      structured_output: {
        event_id: eventId,
        calendar_id: calendarId,
        title: input.title,
        start: input.start,
        end: input.end,
        created_at: createdAt
      }
    };
  }

  async updateEvent(
    input: CalendarUpdateEventInput,
  ): Promise<CalendarExecutionOutcome<CalendarUpdateEventOutput>> {
    const calendarId = input.calendar_id ?? "primary";
    const existing = this.events.get(input.event_id);

    if (!existing) {
      const { CalendarWorkerError } = await import("./adapter.js");
      throw new CalendarWorkerError(
        "EVENT_NOT_FOUND",
        `Event '${input.event_id}' not found in calendar '${calendarId}'.`,
        false,
        { event_id: input.event_id, calendar_id: calendarId }
      );
    }

    const changesApplied: string[] = [];

    if (input.title !== undefined && input.title !== existing.title) {
      existing.title = input.title;
      changesApplied.push("title");
    }
    if (input.start !== undefined && input.start !== existing.start) {
      existing.start = input.start;
      changesApplied.push("start");
    }
    if (input.end !== undefined && input.end !== existing.end) {
      existing.end = input.end;
      changesApplied.push("end");
    }
    if (input.description !== undefined && input.description !== existing.description) {
      existing.description = input.description;
      changesApplied.push("description");
    }
    if (input.location !== undefined && input.location !== existing.location) {
      existing.location = input.location;
      changesApplied.push("location");
    }

    const updatedAt = MOCK_NOW;
    this.events.set(input.event_id, existing);

    return {
      summary: `Updated event '${input.event_id}': ${changesApplied.length > 0 ? changesApplied.join(", ") + " changed." : "no changes applied."}`,
      structured_output: {
        event_id: input.event_id,
        calendar_id: calendarId,
        updated_at: updatedAt,
        changes_applied: changesApplied
      }
    };
  }

  async findFree(
    input: CalendarFindFreeInput,
  ): Promise<CalendarExecutionOutcome<CalendarFindFreeOutput>> {
    const searchStart = new Date(input.start_search);
    const day = searchStart.toISOString().slice(0, 10);

    // Return two hardcoded free slots relative to the search window
    const slots = [
      {
        start: `${day}T10:00:00.000Z`,
        end: `${day}T11:00:00.000Z`,
        duration_minutes: 60
      },
      {
        start: `${day}T14:00:00.000Z`,
        end: `${day}T15:00:00.000Z`,
        duration_minutes: 60
      }
    ].filter((slot) => {
      // Only include slots that fit within the search window and meet duration
      const slotDuration = (new Date(slot.end).getTime() - new Date(slot.start).getTime()) / 60000;
      return slotDuration >= input.duration_minutes;
    });

    return {
      summary: `Found ${slots.length} free slot(s) for ${input.attendees.length} attendee(s) with ${input.duration_minutes}-minute minimum.`,
      structured_output: {
        slots,
        total_slots: slots.length,
        searched_attendees: input.attendees
      }
    };
  }

  async brief(
    input: CalendarBriefInput,
  ): Promise<CalendarExecutionOutcome<CalendarBriefOutput>> {
    const event = this.events.get(input.event_id);

    if (!event) {
      const { CalendarWorkerError } = await import("./adapter.js");
      throw new CalendarWorkerError(
        "EVENT_NOT_FOUND",
        `Event '${input.event_id}' not found — cannot generate brief.`,
        false,
        { event_id: input.event_id }
      );
    }

    const briefAttendees = event.attendees.map((a) => ({
      email: a.email,
      name: a.name,
      company: a.email.includes("nordic-auto") ? "Nordic Auto AB" :
               a.email.includes("zentral-auto") ? "Zentral Automotive GmbH" :
               a.email.includes("apex-motors") ? "Apex Motors AG" :
               a.email.includes("zf") ? "ZF Friedrichshafen" :
               a.email.includes("sigma") ? "Sigma Components" :
               undefined
    }));

    const actionItems = input.include_history
      ? ["Follow up on open ASIL classification items", "Send updated safety plan by EOW"]
      : undefined;

    return {
      summary: `Generated meeting brief for '${event.title}' on ${event.start}.`,
      structured_output: {
        event_id: event.event_id,
        title: event.title,
        start: event.start,
        attendees: briefAttendees,
        key_topics: [
          "Safety goal review and ASIL classification",
          "Open action items from previous session",
          "Timeline and deliverable milestones"
        ],
        recommended_agenda: [
          "10 min — Introductions and scope recap",
          "25 min — Review open technical items",
          "15 min — Action items and next steps"
        ],
        context_notes: `${event.title} is a functional safety consulting engagement. Attendees represent the OEM safety team. All materials are governed by the signed NDA.`,
        action_items_from_last_meeting: actionItems
      }
    };
  }
}

export function createMockCalendarAdapter(): CalendarAdapter {
  return new MockCalendarAdapter();
}
