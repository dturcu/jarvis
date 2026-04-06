import { beforeEach, describe, expect, it } from "vitest";
import {
  CONTRACT_VERSION,
  resetJarvisState
} from "@jarvis/shared";
import {
  MockCalendarAdapter,
  createMockCalendarAdapter,
  createCalendarWorker,
  executeCalendarJob,
  isCalendarJobType,
  CALENDAR_JOB_TYPES,
  MOCK_NOW
} from "@jarvis/calendar-worker";
import type { JobEnvelope } from "@jarvis/shared";

function makeEnvelope(
  type: string,
  input: Record<string, unknown> = {},
  overrides: Partial<JobEnvelope> = {},
): JobEnvelope {
  return {
    contract_version: CONTRACT_VERSION,
    job_id: `test-${Math.random().toString(36).slice(2)}`,
    type: type as JobEnvelope["type"],
    session_key: "agent:main:api:local:adhoc",
    requested_by: { channel: "api", user_id: "test-user" },
    priority: "normal",
    approval_state: "not_required",
    timeout_seconds: 60,
    attempt: 1,
    input,
    artifacts_in: [],
    retry_policy: { mode: "manual", max_attempts: 3 },
    metadata: {
      agent_id: "main",
      thread_key: null
    },
    ...overrides
  };
}

describe("CALENDAR_JOB_TYPES", () => {
  it("contains all 5 calendar job types", () => {
    expect(CALENDAR_JOB_TYPES).toHaveLength(5);
    expect(CALENDAR_JOB_TYPES).toContain("calendar.list_events");
    expect(CALENDAR_JOB_TYPES).toContain("calendar.create_event");
    expect(CALENDAR_JOB_TYPES).toContain("calendar.update_event");
    expect(CALENDAR_JOB_TYPES).toContain("calendar.find_free");
    expect(CALENDAR_JOB_TYPES).toContain("calendar.brief");
  });
});

describe("isCalendarJobType", () => {
  it("returns true for known calendar job types", () => {
    for (const type of CALENDAR_JOB_TYPES) {
      expect(isCalendarJobType(type)).toBe(true);
    }
  });

  it("returns false for unknown job types", () => {
    expect(isCalendarJobType("system.monitor_cpu")).toBe(false);
    expect(isCalendarJobType("office.inspect")).toBe(false);
    expect(isCalendarJobType("unknown.job")).toBe(false);
    expect(isCalendarJobType("")).toBe(false);
  });
});

describe("MockCalendarAdapter", () => {
  let adapter: MockCalendarAdapter;

  beforeEach(() => {
    adapter = new MockCalendarAdapter();
  });

  describe("listEvents", () => {
    it("returns seeded events within a date range", async () => {
      const result = await adapter.listEvents({
        start_date: "2026-04-05T00:00:00.000Z",
        end_date: "2026-04-06T00:00:00.000Z"
      });
      expect(result.structured_output.total_count).toBeGreaterThan(0);
      expect(result.structured_output.calendar_id).toBe("primary");
    });

    it("returns no events for an empty date range", async () => {
      const result = await adapter.listEvents({
        start_date: "2020-01-01T00:00:00.000Z",
        end_date: "2020-01-02T00:00:00.000Z"
      });
      expect(result.structured_output.total_count).toBe(0);
      expect(result.structured_output.events).toHaveLength(0);
    });

    it("filters by query text", async () => {
      const result = await adapter.listEvents({
        start_date: "2026-04-01T00:00:00.000Z",
        end_date: "2026-04-30T00:00:00.000Z",
        query: "AUTOSAR"
      });
      expect(result.structured_output.events.length).toBeGreaterThan(0);
      expect(result.structured_output.events.every((e) =>
        e.title.includes("AUTOSAR") || (e.description ?? "").includes("AUTOSAR")
      )).toBe(true);
    });

    it("respects max_results limit", async () => {
      const result = await adapter.listEvents({
        start_date: "2026-04-01T00:00:00.000Z",
        end_date: "2026-04-30T00:00:00.000Z",
        max_results: 2
      });
      expect(result.structured_output.events.length).toBeLessThanOrEqual(2);
    });

    it("event has correct shape", async () => {
      const result = await adapter.listEvents({
        start_date: "2026-04-05T00:00:00.000Z",
        end_date: "2026-04-06T00:00:00.000Z"
      });
      const event = result.structured_output.events[0]!;
      expect(event).toMatchObject({
        event_id: expect.any(String),
        calendar_id: expect.any(String),
        title: expect.any(String),
        start: expect.any(String),
        end: expect.any(String),
        organizer: expect.any(String),
        status: expect.stringMatching(/^(confirmed|tentative|cancelled)$/),
        is_all_day: expect.any(Boolean)
      });
    });
  });

  describe("createEvent", () => {
    it("creates a new event and returns event_id", async () => {
      const result = await adapter.createEvent({
        title: "Test meeting",
        start: "2026-04-20T10:00:00.000Z",
        end: "2026-04-20T11:00:00.000Z"
      });
      expect(result.structured_output.event_id).toBeTruthy();
      expect(result.structured_output.title).toBe("Test meeting");
      expect(result.structured_output.created_at).toBe(MOCK_NOW);
    });

    it("increments event count after creation", async () => {
      const countBefore = adapter.getEventCount();
      await adapter.createEvent({
        title: "New meeting",
        start: "2026-04-21T09:00:00.000Z",
        end: "2026-04-21T10:00:00.000Z"
      });
      expect(adapter.getEventCount()).toBe(countBefore + 1);
    });

    it("created event is retrievable by ID", async () => {
      const result = await adapter.createEvent({
        title: "Retrievable meeting",
        start: "2026-04-22T14:00:00.000Z",
        end: "2026-04-22T15:00:00.000Z",
        attendees: ["a@test.com", "b@test.com"]
      });
      const stored = adapter.getEvent(result.structured_output.event_id);
      expect(stored).toBeDefined();
      expect(stored!.title).toBe("Retrievable meeting");
    });

    it("throws TypeError when title is missing", async () => {
      await expect(
        adapter.createEvent({ title: "", start: "2026-04-20T10:00:00.000Z", end: "2026-04-20T11:00:00.000Z" })
      ).rejects.toThrow(TypeError);
    });
  });

  describe("updateEvent", () => {
    it("updates title and records changes_applied", async () => {
      const result = await adapter.updateEvent({
        event_id: "evt-autosar-001",
        title: "AUTOSAR safety review v2"
      });
      expect(result.structured_output.changes_applied).toContain("title");
      expect(result.structured_output.event_id).toBe("evt-autosar-001");
      const updated = adapter.getEvent("evt-autosar-001");
      expect(updated!.title).toBe("AUTOSAR safety review v2");
    });

    it("returns empty changes_applied when nothing changed", async () => {
      // Update with same title as existing
      const existing = adapter.getEvent("evt-autosar-001")!;
      const result = await adapter.updateEvent({
        event_id: "evt-autosar-001",
        title: existing.title
      });
      expect(result.structured_output.changes_applied).toHaveLength(0);
    });

    it("throws CalendarWorkerError for unknown event_id", async () => {
      await expect(
        adapter.updateEvent({ event_id: "non-existent-evt" })
      ).rejects.toThrow();
    });

    it("records updated_at as MOCK_NOW", async () => {
      const result = await adapter.updateEvent({
        event_id: "evt-tier1-002",
        location: "New location"
      });
      expect(result.structured_output.updated_at).toBe(MOCK_NOW);
    });
  });

  describe("findFree", () => {
    it("returns free slots for a date range", async () => {
      const result = await adapter.findFree({
        attendees: ["a@test.com", "b@test.com"],
        duration_minutes: 60,
        start_search: "2026-04-10T08:00:00.000Z",
        end_search: "2026-04-10T18:00:00.000Z"
      });
      expect(result.structured_output.total_slots).toBeGreaterThan(0);
      expect(result.structured_output.searched_attendees).toContain("a@test.com");
    });

    it("free slot has correct shape", async () => {
      const result = await adapter.findFree({
        attendees: ["x@test.com"],
        duration_minutes: 30,
        start_search: "2026-04-10T08:00:00.000Z",
        end_search: "2026-04-10T18:00:00.000Z"
      });
      const slot = result.structured_output.slots[0]!;
      expect(slot).toMatchObject({
        start: expect.any(String),
        end: expect.any(String),
        duration_minutes: expect.any(Number)
      });
    });

    it("respects duration_minutes filter", async () => {
      // Request 120 minutes — the 60-minute hardcoded slots won't qualify
      const result = await adapter.findFree({
        attendees: ["x@test.com"],
        duration_minutes: 120,
        start_search: "2026-04-10T08:00:00.000Z",
        end_search: "2026-04-10T18:00:00.000Z"
      });
      // All returned slots must have duration >= 120
      for (const slot of result.structured_output.slots) {
        expect(slot.duration_minutes).toBeGreaterThanOrEqual(120);
      }
    });
  });

  describe("brief", () => {
    it("generates a brief for a known event", async () => {
      const result = await adapter.brief({ event_id: "evt-iso26262-003" });
      expect(result.structured_output.event_id).toBe("evt-iso26262-003");
      expect(result.structured_output.title).toBeTruthy();
      expect(result.structured_output.key_topics.length).toBeGreaterThan(0);
      expect(result.structured_output.recommended_agenda.length).toBeGreaterThan(0);
      expect(result.structured_output.context_notes).toBeTruthy();
    });

    it("includes action_items_from_last_meeting when include_history is true", async () => {
      const result = await adapter.brief({
        event_id: "evt-iso26262-003",
        include_history: true
      });
      expect(result.structured_output.action_items_from_last_meeting).toBeDefined();
      expect(result.structured_output.action_items_from_last_meeting!.length).toBeGreaterThan(0);
    });

    it("omits action_items_from_last_meeting when include_history is false", async () => {
      const result = await adapter.brief({
        event_id: "evt-iso26262-003",
        include_history: false
      });
      expect(result.structured_output.action_items_from_last_meeting).toBeUndefined();
    });

    it("throws CalendarWorkerError for unknown event_id", async () => {
      await expect(
        adapter.brief({ event_id: "non-existent-evt" })
      ).rejects.toThrow();
    });

    it("brief attendees include company when known", async () => {
      const result = await adapter.brief({ event_id: "evt-iso26262-003" });
      const bmwAttendee = result.structured_output.attendees.find((a) =>
        a.email.includes("bmw")
      );
      expect(bmwAttendee).toBeDefined();
      expect(bmwAttendee!.company).toBe("BMW Group");
    });
  });
});

describe("executeCalendarJob", () => {
  let adapter: MockCalendarAdapter;

  beforeEach(() => {
    resetJarvisState();
    adapter = new MockCalendarAdapter();
  });

  it("produces a completed JobResult for calendar.list_events", async () => {
    const envelope = makeEnvelope("calendar.list_events", {
      start_date: "2026-04-05T00:00:00.000Z",
      end_date: "2026-04-06T00:00:00.000Z"
    });
    const result = await executeCalendarJob(envelope, adapter);

    expect(result.contract_version).toBe(CONTRACT_VERSION);
    expect(result.job_id).toBe(envelope.job_id);
    expect(result.job_type).toBe("calendar.list_events");
    expect(result.status).toBe("completed");
    expect(result.attempt).toBe(1);
    expect(result.metrics?.worker_id).toBe("calendar-worker");
    const out = result.structured_output as Record<string, unknown>;
    expect(typeof out.total_count).toBe("number");
    expect(Array.isArray(out.events)).toBe(true);
  });

  it("produces a completed JobResult for calendar.create_event", async () => {
    const envelope = makeEnvelope("calendar.create_event", {
      title: "Test event",
      start: "2026-04-20T10:00:00.000Z",
      end: "2026-04-20T11:00:00.000Z"
    });
    const result = await executeCalendarJob(envelope, adapter);

    expect(result.status).toBe("completed");
    expect(result.job_type).toBe("calendar.create_event");
    const out = result.structured_output as Record<string, unknown>;
    expect(typeof out.event_id).toBe("string");
    expect(out.title).toBe("Test event");
  });

  it("produces a completed JobResult for calendar.update_event", async () => {
    const envelope = makeEnvelope("calendar.update_event", {
      event_id: "evt-tier1-002",
      location: "New location"
    });
    const result = await executeCalendarJob(envelope, adapter);

    expect(result.status).toBe("completed");
    expect(result.job_type).toBe("calendar.update_event");
    const out = result.structured_output as Record<string, unknown>;
    expect(out.event_id).toBe("evt-tier1-002");
    expect(Array.isArray(out.changes_applied)).toBe(true);
  });

  it("produces a completed JobResult for calendar.find_free", async () => {
    const envelope = makeEnvelope("calendar.find_free", {
      attendees: ["a@test.com"],
      duration_minutes: 30,
      start_search: "2026-04-10T08:00:00.000Z",
      end_search: "2026-04-10T18:00:00.000Z"
    });
    const result = await executeCalendarJob(envelope, adapter);

    expect(result.status).toBe("completed");
    expect(result.job_type).toBe("calendar.find_free");
    const out = result.structured_output as Record<string, unknown>;
    expect(Array.isArray(out.slots)).toBe(true);
    expect(typeof out.total_slots).toBe("number");
  });

  it("produces a completed JobResult for calendar.brief", async () => {
    const envelope = makeEnvelope("calendar.brief", {
      event_id: "evt-autosar-001"
    });
    const result = await executeCalendarJob(envelope, adapter);

    expect(result.status).toBe("completed");
    expect(result.job_type).toBe("calendar.brief");
    const out = result.structured_output as Record<string, unknown>;
    expect(out.event_id).toBe("evt-autosar-001");
    expect(Array.isArray(out.key_topics)).toBe(true);
  });

  it("returns failed status for unsupported job type", async () => {
    const envelope = makeEnvelope("system.monitor_cpu", {});
    const result = await executeCalendarJob(envelope, adapter);

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("INVALID_INPUT");
    expect(result.error?.message).toContain("system.monitor_cpu");
    expect(result.error?.retryable).toBe(false);
  });

  it("wraps adapter error into failed result", async () => {
    const faultyAdapter = new MockCalendarAdapter();
    faultyAdapter.listEvents = async () => {
      throw new Error("External calendar API error");
    };

    const envelope = makeEnvelope("calendar.list_events", {
      start_date: "2026-04-05T00:00:00.000Z",
      end_date: "2026-04-06T00:00:00.000Z"
    });
    const result = await executeCalendarJob(envelope, faultyAdapter);

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("INTERNAL_ERROR");
    expect(result.error?.message).toBe("External calendar API error");
  });

  it("uses custom workerId when provided", async () => {
    const envelope = makeEnvelope("calendar.list_events", {
      start_date: "2026-04-05T00:00:00.000Z",
      end_date: "2026-04-06T00:00:00.000Z"
    });
    const result = await executeCalendarJob(envelope, adapter, {
      workerId: "custom-calendar-worker"
    });

    expect(result.status).toBe("completed");
    expect(result.metrics?.worker_id).toBe("custom-calendar-worker");
  });

  it("returns failed result for brief on unknown event", async () => {
    const envelope = makeEnvelope("calendar.brief", {
      event_id: "evt-does-not-exist"
    });
    const result = await executeCalendarJob(envelope, adapter);

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("EVENT_NOT_FOUND");
  });
});

describe("createCalendarWorker", () => {
  beforeEach(() => {
    resetJarvisState();
  });

  it("exposes a default workerId", () => {
    const worker = createCalendarWorker({ adapter: createMockCalendarAdapter() });
    expect(worker.workerId).toBe("calendar-worker");
  });

  it("uses the provided workerId", () => {
    const worker = createCalendarWorker({
      adapter: createMockCalendarAdapter(),
      workerId: "my-calendar-worker"
    });
    expect(worker.workerId).toBe("my-calendar-worker");
  });

  it("executes a job via the worker facade", async () => {
    const worker = createCalendarWorker({ adapter: createMockCalendarAdapter() });
    const envelope = makeEnvelope("calendar.list_events", {
      start_date: "2026-04-01T00:00:00.000Z",
      end_date: "2026-04-30T00:00:00.000Z"
    });
    const result = await worker.execute(envelope);

    expect(result.status).toBe("completed");
    expect(result.metrics?.worker_id).toBe("calendar-worker");
    const out = result.structured_output as Record<string, unknown>;
    expect(Array.isArray(out.events)).toBe(true);
  });
});
