import { TimeWorkerError, type TimeAdapter, type ExecutionOutcome } from "./adapter.js";
import type {
  TimeListEntriesInput,
  TimeListEntriesOutput,
  TimeCreateEntryInput,
  TimeCreateEntryOutput,
  TimeSummaryInput,
  TimeSummaryOutput,
  TimeSyncInput,
  TimeSyncOutput,
  TimeEntry,
} from "./types.js";

const MOCK_NOW = "2026-04-06T12:00:00.000Z";

const MOCK_ENTRIES: TimeEntry[] = [
  {
    id: "te-001",
    description: "ISO 26262 HARA review — brake controller ECU",
    project: "AutomoTech Brake ECU",
    start: "2026-04-04T08:00:00.000Z",
    stop: "2026-04-04T11:30:00.000Z",
    duration_seconds: 12600,
    tags: ["safety", "iso-26262", "billable"],
  },
  {
    id: "te-002",
    description: "AUTOSAR BSW configuration — MCAL layer",
    project: "Tier-1 AUTOSAR Migration",
    start: "2026-04-04T13:00:00.000Z",
    stop: "2026-04-04T17:00:00.000Z",
    duration_seconds: 14400,
    tags: ["autosar", "billable"],
  },
  {
    id: "te-003",
    description: "ASPICE process evidence audit prep",
    project: "AutomoTech Brake ECU",
    start: "2026-04-03T09:00:00.000Z",
    stop: "2026-04-03T12:00:00.000Z",
    duration_seconds: 10800,
    tags: ["aspice", "billable"],
  },
  {
    id: "te-004",
    description: "Internal — BD pipeline review and outreach",
    project: "TIC Internal",
    start: "2026-04-03T14:00:00.000Z",
    stop: "2026-04-03T15:30:00.000Z",
    duration_seconds: 5400,
    tags: ["internal", "bd"],
  },
  {
    id: "te-005",
    description: "Cybersecurity risk assessment — ISO 21434",
    project: "Tier-1 AUTOSAR Migration",
    start: "2026-04-02T08:30:00.000Z",
    stop: "2026-04-02T12:00:00.000Z",
    duration_seconds: 12600,
    tags: ["cybersecurity", "iso-21434", "billable"],
  },
];

export class MockTimeAdapter implements TimeAdapter {
  private entries: TimeEntry[] = MOCK_ENTRIES.map(e => ({ ...e, tags: [...e.tags] }));
  private entryCounter = 100;

  getEntryCount(): number {
    return this.entries.length;
  }

  async listEntries(input: TimeListEntriesInput): Promise<ExecutionOutcome<TimeListEntriesOutput>> {
    let filtered = this.entries.filter(e => {
      const entryDate = e.start.split("T")[0] ?? "";
      return entryDate >= input.start_date && entryDate <= input.end_date;
    });

    if (input.project_id) {
      filtered = filtered.filter(e => e.project.toLowerCase().includes(input.project_id!.toLowerCase()));
    }

    const totalSeconds = filtered.reduce((sum, e) => sum + e.duration_seconds, 0);
    const totalHours = Math.round((totalSeconds / 3600) * 100) / 100;

    return {
      summary: `Found ${filtered.length} time entries totaling ${totalHours} hours (${input.start_date} to ${input.end_date}).`,
      structured_output: {
        entries: filtered,
        total_hours: totalHours,
        period: `${input.start_date} to ${input.end_date}`,
      },
    };
  }

  async createEntry(input: TimeCreateEntryInput): Promise<ExecutionOutcome<TimeCreateEntryOutput>> {
    this.entryCounter += 1;

    const stop = new Date(new Date(input.start).getTime() + input.duration_seconds * 1000).toISOString();

    const entry: TimeEntry = {
      id: `te-mock-${this.entryCounter}`,
      description: input.description,
      project: input.project_id ?? "No Project",
      start: input.start,
      stop,
      duration_seconds: input.duration_seconds,
      tags: input.tags ? [...input.tags] : [],
    };

    this.entries.push(entry);

    return {
      summary: `Created time entry "${input.description}" (${Math.round(input.duration_seconds / 60)} minutes).`,
      structured_output: {
        entry,
        created: true,
      },
    };
  }

  async summary(input: TimeSummaryInput): Promise<ExecutionOutcome<TimeSummaryOutput>> {
    const filtered = this.entries.filter(e => {
      const entryDate = e.start.split("T")[0] ?? "";
      return entryDate >= input.start_date && entryDate <= input.end_date;
    });

    const groupBy = input.group_by ?? "project";
    const groupMap = new Map<string, { totalSeconds: number; count: number }>();

    for (const entry of filtered) {
      let key: string;

      switch (groupBy) {
        case "project":
          key = entry.project;
          break;
        case "day":
          key = entry.start.split("T")[0] ?? entry.start;
          break;
        case "tag":
          if (entry.tags.length > 0) {
            for (const tag of entry.tags) {
              const existing = groupMap.get(tag) ?? { totalSeconds: 0, count: 0 };
              existing.totalSeconds += entry.duration_seconds;
              existing.count += 1;
              groupMap.set(tag, existing);
            }
            continue;
          }
          key = "Untagged";
          break;
        default:
          key = "All";
      }

      const existing = groupMap.get(key) ?? { totalSeconds: 0, count: 0 };
      existing.totalSeconds += entry.duration_seconds;
      existing.count += 1;
      groupMap.set(key, existing);
    }

    const groups = [...groupMap.entries()].map(([key, data]) => ({
      key,
      total_hours: Math.round((data.totalSeconds / 3600) * 100) / 100,
      entry_count: data.count,
    }));

    const totalSeconds = filtered.reduce((sum, e) => sum + e.duration_seconds, 0);
    const totalHours = Math.round((totalSeconds / 3600) * 100) / 100;

    return {
      summary: `Time summary: ${groups.length} groups, ${totalHours} total hours (${input.start_date} to ${input.end_date}).`,
      structured_output: {
        groups,
        total_hours: totalHours,
        period: `${input.start_date} to ${input.end_date}`,
      },
    };
  }

  async sync(input: TimeSyncInput): Promise<ExecutionOutcome<TimeSyncOutput>> {
    const direction = input.direction ?? "pull";

    return {
      summary: `Synced ${this.entries.length} entries (direction: ${direction}).`,
      structured_output: {
        synced_entries: this.entries.length,
        direction,
        synced_at: MOCK_NOW,
      },
    };
  }
}

export function createMockTimeAdapter(): TimeAdapter {
  return new MockTimeAdapter();
}
