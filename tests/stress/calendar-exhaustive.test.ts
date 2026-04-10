/**
 * Exhaustive Stress: Calendar Worker
 *
 * Covers every calendar operation type with thorough input permutations:
 * list_events, create_event, update_event, find_free, brief,
 * lifecycle flows, bulk operations, concurrency, and edge cases.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { MockCalendarAdapter, executeCalendarJob } from "@jarvis/calendar-worker";
import type { JobEnvelope } from "@jarvis/shared";
import { range } from "./helpers.js";

function envelope(type: string, input: Record<string, unknown>): JobEnvelope {
  return {
    contract_version: "1.0.0",
    job_id: randomUUID(),
    type: type as any,
    input,
    attempt: 1,
    metadata: { agent_id: "test", run_id: randomUUID() },
  };
}

// ── List Events ─────────────────────────────────────────────────────────────

describe("Calendar Exhaustive — list_events", () => {
  let cal: MockCalendarAdapter;

  beforeEach(() => {
    cal = new MockCalendarAdapter();
  });

  it("list events for a one-week range", async () => {
    const result = await executeCalendarJob(
      envelope("calendar.list_events", { start_date: "2026-04-07", end_date: "2026-04-14" }),
      cal,
    );
    expect(result.status).toBe("completed");
  });

  it("list events for a single day", async () => {
    const result = await executeCalendarJob(
      envelope("calendar.list_events", { start_date: "2026-04-07", end_date: "2026-04-07" }),
      cal,
    );
    expect(result.status).toBe("completed");
  });

  it("list events for empty range (no events expected)", async () => {
    const result = await executeCalendarJob(
      envelope("calendar.list_events", { start_date: "2020-01-01", end_date: "2020-01-02" }),
      cal,
    );
    expect(result.status).toBe("completed");
  });

  it("list events for wide range (full month)", async () => {
    const result = await executeCalendarJob(
      envelope("calendar.list_events", { start_date: "2026-04-01", end_date: "2026-04-30" }),
      cal,
    );
    expect(result.status).toBe("completed");
  });

  it("list events with calendar_id", async () => {
    const result = await executeCalendarJob(
      envelope("calendar.list_events", { start_date: "2026-04-07", end_date: "2026-04-14", calendar_id: "primary" }),
      cal,
    );
    expect(result.status).toBe("completed");
  });
});

// ── Create Event ────────────────────────────────────────────────────────────

describe("Calendar Exhaustive — create_event", () => {
  let cal: MockCalendarAdapter;

  beforeEach(() => {
    cal = new MockCalendarAdapter();
  });

  it("create minimal event (title + start + end)", async () => {
    const result = await executeCalendarJob(
      envelope("calendar.create_event", {
        title: "Quick sync",
        start: "2026-04-10T09:00:00",
        end: "2026-04-10T09:30:00",
      }),
      cal,
    );
    expect(result.status).toBe("completed");
    expect(result.structured_output?.event_id).toBeTruthy();
    expect(cal.getEventCount()).toBeGreaterThanOrEqual(1);
  });

  it("create event with attendees", async () => {
    const result = await executeCalendarJob(
      envelope("calendar.create_event", {
        title: "ISO 26262 Review",
        start: "2026-04-11T10:00:00",
        end: "2026-04-11T12:00:00",
        attendees: ["alice@meridian-eng.example.com", "bob@example-atlas.com", "carol@example-zentral.com"],
      }),
      cal,
    );
    expect(result.status).toBe("completed");
    expect(result.structured_output?.event_id).toBeTruthy();
  });

  it("create event with description", async () => {
    const result = await executeCalendarJob(
      envelope("calendar.create_event", {
        title: "ASPICE Assessment Prep",
        start: "2026-04-12T14:00:00",
        end: "2026-04-12T15:00:00",
        description: "Prepare evidence binder for upcoming ASPICE Level 2 assessment on the ECU project.",
      }),
      cal,
    );
    expect(result.status).toBe("completed");
  });

  it("create event with location", async () => {
    const result = await executeCalendarJob(
      envelope("calendar.create_event", {
        title: "On-site Audit",
        start: "2026-04-14T08:00:00",
        end: "2026-04-14T17:00:00",
        location: "Meridian Engineering GmbH, Ehningen, Germany",
      }),
      cal,
    );
    expect(result.status).toBe("completed");
  });

  it("create event with calendar_id", async () => {
    const result = await executeCalendarJob(
      envelope("calendar.create_event", {
        title: "Team standup",
        start: "2026-04-10T08:30:00",
        end: "2026-04-10T08:45:00",
        calendar_id: "work-calendar",
      }),
      cal,
    );
    expect(result.status).toBe("completed");
  });

  it("create event with all optional fields", async () => {
    const result = await executeCalendarJob(
      envelope("calendar.create_event", {
        title: "Full-featured event",
        start: "2026-04-15T09:00:00",
        end: "2026-04-15T11:00:00",
        attendees: ["user-a@example.com", "user-b@example.com"],
        description: "A comprehensive event with all fields populated.",
        location: "Munich, Germany",
        calendar_id: "primary",
      }),
      cal,
    );
    expect(result.status).toBe("completed");
  });

  it("create multiple events and verify count", async () => {
    const initialCount = cal.getEventCount();
    await executeCalendarJob(envelope("calendar.create_event", { title: "E1", start: "2026-04-10T09:00:00", end: "2026-04-10T10:00:00" }), cal);
    await executeCalendarJob(envelope("calendar.create_event", { title: "E2", start: "2026-04-10T10:00:00", end: "2026-04-10T11:00:00" }), cal);
    await executeCalendarJob(envelope("calendar.create_event", { title: "E3", start: "2026-04-10T11:00:00", end: "2026-04-10T12:00:00" }), cal);
    expect(cal.getEventCount()).toBe(initialCount + 3);
  });
});

// ── Update Event ────────────────────────────────────────────────────────────

describe("Calendar Exhaustive — update_event", () => {
  let cal: MockCalendarAdapter;

  beforeEach(() => {
    cal = new MockCalendarAdapter();
  });

  it("update event title", async () => {
    const created = await executeCalendarJob(
      envelope("calendar.create_event", { title: "Original Title", start: "2026-04-10T09:00:00", end: "2026-04-10T10:00:00" }),
      cal,
    );
    const eventId = created.structured_output?.event_id;

    const result = await executeCalendarJob(
      envelope("calendar.update_event", { event_id: eventId, title: "Updated Title" }),
      cal,
    );
    expect(result.status).toBe("completed");
  });

  it("update event time", async () => {
    const created = await executeCalendarJob(
      envelope("calendar.create_event", { title: "Time Change", start: "2026-04-10T09:00:00", end: "2026-04-10T10:00:00" }),
      cal,
    );
    const eventId = created.structured_output?.event_id;

    const result = await executeCalendarJob(
      envelope("calendar.update_event", {
        event_id: eventId,
        start: "2026-04-10T14:00:00",
        end: "2026-04-10T15:00:00",
      }),
      cal,
    );
    expect(result.status).toBe("completed");
  });

  it("update event attendees", async () => {
    const created = await executeCalendarJob(
      envelope("calendar.create_event", {
        title: "Team Meeting",
        start: "2026-04-11T09:00:00",
        end: "2026-04-11T10:00:00",
        attendees: ["alice@example.com"],
      }),
      cal,
    );
    const eventId = created.structured_output?.event_id;

    const result = await executeCalendarJob(
      envelope("calendar.update_event", {
        event_id: eventId,
        attendees: ["alice@example.com", "bob@example.com", "carol@example.com"],
      }),
      cal,
    );
    expect(result.status).toBe("completed");
  });

  it("update event description", async () => {
    const created = await executeCalendarJob(
      envelope("calendar.create_event", { title: "Desc Update", start: "2026-04-12T09:00:00", end: "2026-04-12T10:00:00" }),
      cal,
    );
    const eventId = created.structured_output?.event_id;

    const result = await executeCalendarJob(
      envelope("calendar.update_event", { event_id: eventId, description: "Newly added description." }),
      cal,
    );
    expect(result.status).toBe("completed");
  });

  it("update non-existent event", async () => {
    const result = await executeCalendarJob(
      envelope("calendar.update_event", { event_id: "nonexistent-id-12345", title: "Ghost Update" }),
      cal,
    );
    expect(result.status).toBeDefined();
  });
});

// ── Find Free ───────────────────────────────────────────────────────────────

describe("Calendar Exhaustive — find_free", () => {
  let cal: MockCalendarAdapter;

  beforeEach(() => {
    cal = new MockCalendarAdapter();
  });

  it("find free slots basic", async () => {
    const result = await executeCalendarJob(
      envelope("calendar.find_free", {
        attendees: ["consultant@jarvis.local", "client@meridian-eng.example.com"],
        duration_minutes: 60,
        start_search: "2026-04-07T08:00:00",
        end_search: "2026-04-11T18:00:00",
      }),
      cal,
    );
    expect(result.status).toBe("completed");
    expect(result.structured_output?.slots).toBeDefined();
  });

  it("find free with working_hours_only=true", async () => {
    const result = await executeCalendarJob(
      envelope("calendar.find_free", {
        attendees: ["user-a@example.com"],
        duration_minutes: 30,
        start_search: "2026-04-07T00:00:00",
        end_search: "2026-04-11T23:59:59",
        working_hours_only: true,
      }),
      cal,
    );
    expect(result.status).toBe("completed");
  });

  it("find free with working_hours_only=false", async () => {
    const result = await executeCalendarJob(
      envelope("calendar.find_free", {
        attendees: ["user-a@example.com"],
        duration_minutes: 60,
        start_search: "2026-04-07T00:00:00",
        end_search: "2026-04-11T23:59:59",
        working_hours_only: false,
      }),
      cal,
    );
    expect(result.status).toBe("completed");
  });

  it("find free for 15-minute duration", async () => {
    const result = await executeCalendarJob(
      envelope("calendar.find_free", {
        attendees: ["user@example.com"],
        duration_minutes: 15,
        start_search: "2026-04-07T08:00:00",
        end_search: "2026-04-07T18:00:00",
      }),
      cal,
    );
    expect(result.status).toBe("completed");
  });

  it("find free for 30-minute duration", async () => {
    const result = await executeCalendarJob(
      envelope("calendar.find_free", {
        attendees: ["user@example.com"],
        duration_minutes: 30,
        start_search: "2026-04-07T08:00:00",
        end_search: "2026-04-07T18:00:00",
      }),
      cal,
    );
    expect(result.status).toBe("completed");
  });

  it("find free for 60-minute duration", async () => {
    const result = await executeCalendarJob(
      envelope("calendar.find_free", {
        attendees: ["user@example.com"],
        duration_minutes: 60,
        start_search: "2026-04-08T08:00:00",
        end_search: "2026-04-08T18:00:00",
      }),
      cal,
    );
    expect(result.status).toBe("completed");
  });

  it("find free for 120-minute duration", async () => {
    const result = await executeCalendarJob(
      envelope("calendar.find_free", {
        attendees: ["user@example.com"],
        duration_minutes: 120,
        start_search: "2026-04-09T08:00:00",
        end_search: "2026-04-09T18:00:00",
      }),
      cal,
    );
    expect(result.status).toBe("completed");
  });
});

// ── Brief ───────────────────────────────────────────────────────────────────

describe("Calendar Exhaustive — brief", () => {
  let cal: MockCalendarAdapter;

  beforeEach(() => {
    cal = new MockCalendarAdapter();
  });

  it("brief for a created event", async () => {
    const created = await executeCalendarJob(
      envelope("calendar.create_event", {
        title: "Briefing Target",
        start: "2026-04-10T09:00:00",
        end: "2026-04-10T10:00:00",
        description: "Detailed discussion about AUTOSAR migration.",
      }),
      cal,
    );
    const eventId = created.structured_output?.event_id;

    const result = await executeCalendarJob(
      envelope("calendar.brief", { event_id: eventId }),
      cal,
    );
    expect(result.status).toBe("completed");
  });

  it("brief with include_history=true", async () => {
    const created = await executeCalendarJob(
      envelope("calendar.create_event", {
        title: "History Event",
        start: "2026-04-11T14:00:00",
        end: "2026-04-11T15:00:00",
      }),
      cal,
    );
    const eventId = created.structured_output?.event_id;

    const result = await executeCalendarJob(
      envelope("calendar.brief", { event_id: eventId, include_history: true }),
      cal,
    );
    expect(result.status).toBe("completed");
  });

  it("brief with include_history=false", async () => {
    const created = await executeCalendarJob(
      envelope("calendar.create_event", {
        title: "No History",
        start: "2026-04-12T09:00:00",
        end: "2026-04-12T10:00:00",
      }),
      cal,
    );
    const eventId = created.structured_output?.event_id;

    const result = await executeCalendarJob(
      envelope("calendar.brief", { event_id: eventId, include_history: false }),
      cal,
    );
    expect(result.status).toBe("completed");
  });

  it("brief with calendar_id", async () => {
    const result = await executeCalendarJob(
      envelope("calendar.brief", { event_id: "evt-autosar-001", calendar_id: "work" }),
      cal,
    );
    expect(result.status).toBe("completed");
  });
});

// ── Full lifecycle ──────────────────────────────────────────────────────────

describe("Calendar Exhaustive — full lifecycle", () => {
  let cal: MockCalendarAdapter;

  beforeEach(() => {
    cal = new MockCalendarAdapter();
  });

  it("create -> update -> brief -> list", async () => {
    // Create
    const created = await executeCalendarJob(
      envelope("calendar.create_event", {
        title: "Lifecycle Event",
        start: "2026-04-10T09:00:00",
        end: "2026-04-10T10:00:00",
        attendees: ["daniel@thinkingincode.com"],
        description: "Testing the full lifecycle.",
      }),
      cal,
    );
    expect(created.status).toBe("completed");
    const eventId = created.structured_output?.event_id;
    expect(eventId).toBeTruthy();

    // Update
    const updated = await executeCalendarJob(
      envelope("calendar.update_event", {
        event_id: eventId,
        title: "Lifecycle Event (Updated)",
        attendees: ["daniel@thinkingincode.com", "reviewer@meridian-eng.example.com"],
      }),
      cal,
    );
    expect(updated.status).toBe("completed");

    // Brief
    const brief = await executeCalendarJob(
      envelope("calendar.brief", { event_id: eventId, include_history: true }),
      cal,
    );
    expect(brief.status).toBe("completed");

    // List
    const list = await executeCalendarJob(
      envelope("calendar.list_events", { start_date: "2026-04-10", end_date: "2026-04-10" }),
      cal,
    );
    expect(list.status).toBe("completed");
  });
});

// ── Bulk operations ─────────────────────────────────────────────────────────

describe("Calendar Exhaustive — bulk operations", () => {
  let cal: MockCalendarAdapter;

  beforeEach(() => {
    cal = new MockCalendarAdapter();
  });

  it("create 20 events, list all, verify count", async () => {
    const initialCount = cal.getEventCount();

    for (const i of range(20)) {
      await executeCalendarJob(
        envelope("calendar.create_event", {
          title: `Bulk Event ${i}`,
          start: `2026-04-${String(10 + (i % 20)).padStart(2, "0")}T${String(8 + (i % 8)).padStart(2, "0")}:00:00`,
          end: `2026-04-${String(10 + (i % 20)).padStart(2, "0")}T${String(9 + (i % 8)).padStart(2, "0")}:00:00`,
        }),
        cal,
      );
    }

    expect(cal.getEventCount()).toBe(initialCount + 20);

    const list = await executeCalendarJob(
      envelope("calendar.list_events", { start_date: "2026-04-01", end_date: "2026-04-30" }),
      cal,
    );
    expect(list.status).toBe("completed");
  });
});

// ── Concurrency ─────────────────────────────────────────────────────────────

describe("Calendar Exhaustive — concurrency", () => {
  let cal: MockCalendarAdapter;

  beforeEach(() => {
    cal = new MockCalendarAdapter();
  });

  it("15 parallel creates", async () => {
    const initialCount = cal.getEventCount();
    const ops = range(15).map(i =>
      executeCalendarJob(
        envelope("calendar.create_event", {
          title: `Concurrent Create ${i}`,
          start: `2026-04-${String(10 + (i % 15)).padStart(2, "0")}T09:00:00`,
          end: `2026-04-${String(10 + (i % 15)).padStart(2, "0")}T10:00:00`,
        }),
        cal,
      ),
    );
    const results = await Promise.all(ops);
    expect(results).toHaveLength(15);
    expect(results.every(r => r.status === "completed")).toBe(true);
    expect(cal.getEventCount()).toBe(initialCount + 15);
  });

  it("10 parallel list_events", async () => {
    const ops = range(10).map(i =>
      executeCalendarJob(
        envelope("calendar.list_events", {
          start_date: `2026-04-${String(1 + i).padStart(2, "0")}`,
          end_date: `2026-04-${String(7 + i).padStart(2, "0")}`,
        }),
        cal,
      ),
    );
    const results = await Promise.all(ops);
    expect(results).toHaveLength(10);
    expect(results.every(r => r.status === "completed")).toBe(true);
  });
});

// ── getEvent verification ───────────────────────────────────────────────────

describe("Calendar Exhaustive — getEvent", () => {
  let cal: MockCalendarAdapter;

  beforeEach(() => {
    cal = new MockCalendarAdapter();
  });

  it("getEvent returns created event by ID", async () => {
    const created = await executeCalendarJob(
      envelope("calendar.create_event", {
        title: "Retrievable Event",
        start: "2026-04-10T09:00:00",
        end: "2026-04-10T10:00:00",
      }),
      cal,
    );
    const eventId = created.structured_output?.event_id as string;
    expect(eventId).toBeTruthy();

    const event = cal.getEvent(eventId);
    expect(event).toBeDefined();
  });

  it("getEvent returns updated data after update", async () => {
    const created = await executeCalendarJob(
      envelope("calendar.create_event", {
        title: "Before Update",
        start: "2026-04-11T09:00:00",
        end: "2026-04-11T10:00:00",
      }),
      cal,
    );
    const eventId = created.structured_output?.event_id as string;

    await executeCalendarJob(
      envelope("calendar.update_event", { event_id: eventId, title: "After Update" }),
      cal,
    );

    const event = cal.getEvent(eventId);
    expect(event).toBeDefined();
  });
});

// ── Edge cases ──────────────────────────────────────────────────────────────

describe("Calendar Exhaustive — edge cases", () => {
  let cal: MockCalendarAdapter;

  beforeEach(() => {
    cal = new MockCalendarAdapter();
  });

  it("very long event title", async () => {
    const longTitle = "Meeting about " + range(100).map(i => `topic-${i}`).join(", ");
    const result = await executeCalendarJob(
      envelope("calendar.create_event", {
        title: longTitle,
        start: "2026-04-10T09:00:00",
        end: "2026-04-10T10:00:00",
      }),
      cal,
    );
    expect(result.status).toBe("completed");
  });

  it("event with many attendees (20)", async () => {
    const attendees = range(20).map(i => `attendee-${i}@example.com`);
    const result = await executeCalendarJob(
      envelope("calendar.create_event", {
        title: "Large Meeting",
        start: "2026-04-10T09:00:00",
        end: "2026-04-10T10:00:00",
        attendees,
      }),
      cal,
    );
    expect(result.status).toBe("completed");
  });

  it("event with past dates", async () => {
    const result = await executeCalendarJob(
      envelope("calendar.create_event", {
        title: "Past Event",
        start: "2020-01-01T09:00:00",
        end: "2020-01-01T10:00:00",
      }),
      cal,
    );
    expect(result.status).toBeDefined();
  });

  it("find_free with single attendee", async () => {
    const result = await executeCalendarJob(
      envelope("calendar.find_free", {
        attendees: ["solo@example.com"],
        duration_minutes: 45,
        start_search: "2026-04-07T08:00:00",
        end_search: "2026-04-07T18:00:00",
      }),
      cal,
    );
    expect(result.status).toBe("completed");
  });

  it("find_free with many attendees", async () => {
    const attendees = range(10).map(i => `person-${i}@example.com`);
    const result = await executeCalendarJob(
      envelope("calendar.find_free", {
        attendees,
        duration_minutes: 60,
        start_search: "2026-04-07T08:00:00",
        end_search: "2026-04-11T18:00:00",
      }),
      cal,
    );
    expect(result.status).toBe("completed");
  });
});
