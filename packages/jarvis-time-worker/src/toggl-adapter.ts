import https from "node:https";
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

// ── Toggl API types ──────────────────────────────────────────────────────────

type TogglTimeEntry = {
  id: number;
  description: string;
  project_id: number | null;
  start: string;
  stop: string | null;
  duration: number;
  tags: string[] | null;
  workspace_id: number;
};

type TogglProject = {
  id: number;
  name: string;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function toBasicAuth(apiToken: string): string {
  return Buffer.from(`${apiToken}:api_token`).toString("base64");
}

function togglRequest<T>(
  method: string,
  path: string,
  authHeader: string,
  body?: Record<string, unknown>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined;

    const options: https.RequestOptions = {
      hostname: "api.track.toggl.com",
      port: 443,
      path,
      method,
      headers: {
        "Authorization": `Basic ${authHeader}`,
        "Content-Type": "application/json",
        ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk: Buffer) => { data += chunk.toString(); });
      res.on("end", () => {
        const statusCode = res.statusCode ?? 0;
        if (statusCode >= 200 && statusCode < 300) {
          try {
            resolve(data ? (JSON.parse(data) as T) : ({} as T));
          } catch {
            resolve({} as T);
          }
        } else if (statusCode === 429) {
          reject(new TimeWorkerError("RATE_LIMITED", "Toggl API rate limit exceeded.", true, { status: statusCode }));
        } else if (statusCode === 401 || statusCode === 403) {
          reject(new TimeWorkerError("AUTH_ERROR", `Toggl authentication failed (${statusCode}).`, false, { status: statusCode }));
        } else {
          reject(new TimeWorkerError("TOGGL_API_ERROR", `Toggl API error: ${statusCode} — ${data.slice(0, 200)}`, statusCode >= 500, { status: statusCode }));
        }
      });
      res.on("error", reject);
    });

    req.on("error", (err) => {
      reject(new TimeWorkerError("NETWORK_ERROR", `Network error: ${err.message}`, true));
    });

    if (payload) req.write(payload);
    req.end();
  });
}

function toTimeEntry(entry: TogglTimeEntry, projectMap: Map<number, string>): TimeEntry {
  return {
    id: String(entry.id),
    description: entry.description ?? "",
    project: entry.project_id ? (projectMap.get(entry.project_id) ?? String(entry.project_id)) : "No Project",
    start: entry.start,
    stop: entry.stop ?? "",
    duration_seconds: entry.duration >= 0 ? entry.duration : 0,
    tags: entry.tags ?? [],
  };
}

// ── TogglAdapter ─────────────────────────────────────────────────────────────

export type TogglAdapterConfig = {
  api_token: string;
  workspace_id: string;
};

export class TogglAdapter implements TimeAdapter {
  private readonly auth: string;
  private readonly workspaceId: string;
  private projectCache: Map<number, string> | null = null;

  constructor(config: TogglAdapterConfig) {
    this.auth = toBasicAuth(config.api_token);
    this.workspaceId = config.workspace_id;
  }

  private async getProjectMap(): Promise<Map<number, string>> {
    if (this.projectCache) return this.projectCache;

    try {
      const projects = await togglRequest<TogglProject[]>(
        "GET",
        `/api/v9/workspaces/${this.workspaceId}/projects`,
        this.auth,
      );
      this.projectCache = new Map(projects.map(p => [p.id, p.name]));
    } catch {
      this.projectCache = new Map();
    }
    return this.projectCache;
  }

  // ── listEntries ────────────────────────────────────────────────────────────

  async listEntries(input: TimeListEntriesInput): Promise<ExecutionOutcome<TimeListEntriesOutput>> {
    try {
      const params = new URLSearchParams({
        start_date: input.start_date,
        end_date: input.end_date,
      });

      const entries = await togglRequest<TogglTimeEntry[]>(
        "GET",
        `/api/v9/me/time_entries?${params.toString()}`,
        this.auth,
      );

      const projectMap = await this.getProjectMap();

      let filtered = entries;
      if (input.project_id) {
        const pid = Number(input.project_id);
        filtered = entries.filter(e => e.project_id === pid);
      }

      const mapped = filtered.map(e => toTimeEntry(e, projectMap));
      const totalSeconds = mapped.reduce((sum, e) => sum + e.duration_seconds, 0);
      const totalHours = Math.round((totalSeconds / 3600) * 100) / 100;

      return {
        summary: `Found ${mapped.length} time entries totaling ${totalHours} hours (${input.start_date} to ${input.end_date}).`,
        structured_output: {
          entries: mapped,
          total_hours: totalHours,
          period: `${input.start_date} to ${input.end_date}`,
        },
      };
    } catch (error) {
      throw this.wrapError("listEntries", error);
    }
  }

  // ── createEntry ────────────────────────────────────────────────────────────

  async createEntry(input: TimeCreateEntryInput): Promise<ExecutionOutcome<TimeCreateEntryOutput>> {
    try {
      const body: Record<string, unknown> = {
        description: input.description,
        start: input.start,
        duration: input.duration_seconds,
        created_with: "jarvis-time-worker",
        workspace_id: Number(this.workspaceId),
      };

      if (input.project_id) body.project_id = Number(input.project_id);
      if (input.tags && input.tags.length > 0) body.tags = input.tags;

      const created = await togglRequest<TogglTimeEntry>(
        "POST",
        `/api/v9/workspaces/${this.workspaceId}/time_entries`,
        this.auth,
        body,
      );

      const projectMap = await this.getProjectMap();
      const entry = toTimeEntry(created, projectMap);

      return {
        summary: `Created time entry "${input.description}" (${Math.round(input.duration_seconds / 60)} minutes).`,
        structured_output: {
          entry,
          created: true,
        },
      };
    } catch (error) {
      throw this.wrapError("createEntry", error);
    }
  }

  // ── summary ────────────────────────────────────────────────────────────────

  async summary(input: TimeSummaryInput): Promise<ExecutionOutcome<TimeSummaryOutput>> {
    try {
      const params = new URLSearchParams({
        start_date: input.start_date,
        end_date: input.end_date,
      });

      const entries = await togglRequest<TogglTimeEntry[]>(
        "GET",
        `/api/v9/me/time_entries?${params.toString()}`,
        this.auth,
      );

      const projectMap = await this.getProjectMap();
      const groupBy = input.group_by ?? "project";
      const groupMap = new Map<string, { totalSeconds: number; count: number }>();

      for (const entry of entries) {
        const duration = entry.duration >= 0 ? entry.duration : 0;
        let key: string;

        switch (groupBy) {
          case "project":
            key = entry.project_id ? (projectMap.get(entry.project_id) ?? String(entry.project_id)) : "No Project";
            break;
          case "day":
            key = entry.start.split("T")[0] ?? entry.start;
            break;
          case "tag":
            if (entry.tags && entry.tags.length > 0) {
              // Each tag gets its own group entry
              for (const tag of entry.tags) {
                const existing = groupMap.get(tag) ?? { totalSeconds: 0, count: 0 };
                existing.totalSeconds += duration;
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
        existing.totalSeconds += duration;
        existing.count += 1;
        groupMap.set(key, existing);
      }

      const groups = [...groupMap.entries()].map(([key, data]) => ({
        key,
        total_hours: Math.round((data.totalSeconds / 3600) * 100) / 100,
        entry_count: data.count,
      }));

      const totalSeconds = entries.reduce((sum, e) => sum + (e.duration >= 0 ? e.duration : 0), 0);
      const totalHours = Math.round((totalSeconds / 3600) * 100) / 100;

      return {
        summary: `Time summary: ${groups.length} groups, ${totalHours} total hours (${input.start_date} to ${input.end_date}).`,
        structured_output: {
          groups,
          total_hours: totalHours,
          period: `${input.start_date} to ${input.end_date}`,
        },
      };
    } catch (error) {
      throw this.wrapError("summary", error);
    }
  }

  // ── sync ───────────────────────────────────────────────────────────────────

  async sync(input: TimeSyncInput): Promise<ExecutionOutcome<TimeSyncOutput>> {
    const direction = input.direction ?? "pull";

    try {
      let syncedEntries = 0;

      if (direction === "pull" || direction === "both") {
        // Pull: fetch recent entries from Toggl (last 7 days)
        const now = new Date();
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const params = new URLSearchParams({
          start_date: weekAgo.toISOString().split("T")[0]!,
          end_date: now.toISOString().split("T")[0]!,
        });

        const entries = await togglRequest<TogglTimeEntry[]>(
          "GET",
          `/api/v9/me/time_entries?${params.toString()}`,
          this.auth,
        );
        syncedEntries += entries.length;
      }

      if (direction === "push" || direction === "both") {
        // Push: placeholder for pushing local entries to Toggl
        // In a full implementation, this would read from a local store
        // and create entries in Toggl that don't exist yet
        syncedEntries += 0;
      }

      return {
        summary: `Synced ${syncedEntries} entries (direction: ${direction}).`,
        structured_output: {
          synced_entries: syncedEntries,
          direction,
          synced_at: new Date().toISOString(),
        },
      };
    } catch (error) {
      throw this.wrapError("sync", error);
    }
  }

  // ── Error helpers ──────────────────────────────────────────────────────────

  private wrapError(operation: string, error: unknown): TimeWorkerError {
    if (error instanceof TimeWorkerError) return error;

    const message = error instanceof Error
      ? error.message
      : `Toggl API error during ${operation}.`;

    return new TimeWorkerError(
      "TOGGL_API_ERROR",
      message,
      false,
      { operation },
    );
  }
}
