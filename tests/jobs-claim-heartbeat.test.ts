import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

let mockState: {
  requeueExpiredJobs: ReturnType<typeof vi.fn>;
  claimJob: ReturnType<typeof vi.fn>;
  heartbeatJob: ReturnType<typeof vi.fn>;
};

vi.mock("@jarvis/shared", async () => {
  const actual =
    await vi.importActual<typeof import("@jarvis/shared")>("@jarvis/shared");

  return {
    ...actual,
    getJarvisState: () => mockState
  };
});

import {
  handleJobsClaim,
  handleJobsHeartbeat
} from "@jarvis/jobs";

function createMockResponse() {
  let body = "";

  return {
    response: {
      statusCode: 0,
      headers: {} as Record<string, string>,
      setHeader(name: string, value: string) {
        this.headers[name] = value;
      },
      end(chunk?: string | Buffer) {
        if (chunk) {
          body += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk;
        }
      }
    },
    readBody() {
      return body;
    }
  };
}

describe("Jarvis jobs claim and heartbeat routes", () => {
  beforeEach(() => {
    mockState = {
      requeueExpiredJobs: vi.fn(),
      claimJob: vi.fn(),
      heartbeatJob: vi.fn()
    };
  });

  it("claims a queued job", async () => {
    mockState.claimJob.mockReturnValue({
      claimed: true,
      job_id: "job-1",
      claim_id: "claim-1",
      status: "claimed",
      summary: "Claimed office.preview.",
      lease_expires_at: "2026-04-04T12:10:00.000Z",
      attempt: 1,
      job_type: "office.preview"
    });

    const request = Readable.from([
      JSON.stringify({
        worker_id: "worker-1",
        worker_type: "desktop-host",
        run_group: "main"
      })
    ]) as any;
    const response = createMockResponse();

    await handleJobsClaim(request, response.response as any);

    expect(response.response.statusCode).toBe(200);
    expect(JSON.parse(response.readBody())).toMatchObject({
      ok: true,
      claimed: true,
      status: "claimed",
      job_id: "job-1",
      claim_id: "claim-1",
      summary: "Claimed office.preview."
    });
    expect(mockState.requeueExpiredJobs).toHaveBeenCalledTimes(1);
    expect(mockState.claimJob).toHaveBeenCalledWith(
      expect.objectContaining({
        worker_id: "worker-1",
        worker_type: "desktop-host",
        run_group: "main",
        requested_at: expect.any(String)
      })
    );
  });

  it("returns a no-work response when nothing is queued", async () => {
    mockState.claimJob.mockReturnValue(null);

    const request = Readable.from([
      JSON.stringify({
        worker_id: "worker-2"
      })
    ]) as any;
    const response = createMockResponse();

    await handleJobsClaim(request, response.response as any);

    expect(response.response.statusCode).toBe(200);
    expect(JSON.parse(response.readBody())).toMatchObject({
      ok: true,
      claimed: false,
      status: "no_work",
      summary: "No queued jobs are available."
    });
    expect(mockState.requeueExpiredJobs).toHaveBeenCalledTimes(1);
    expect(mockState.claimJob).toHaveBeenCalledWith(
      expect.objectContaining({
        worker_id: "worker-2",
        requested_at: expect.any(String)
      })
    );
  });

  it("acknowledges a heartbeat", async () => {
    mockState.heartbeatJob.mockReturnValue({
      acknowledged: true,
      job_id: "job-1",
      claim_id: "claim-1",
      status: "running",
      summary: "Heartbeat accepted.",
      lease_expires_at: "2026-04-04T12:15:00.000Z"
    });

    const request = Readable.from([
      JSON.stringify({
        worker_id: "worker-1",
        job_id: "job-1",
        claim_id: "claim-1",
        status: "running"
      })
    ]) as any;
    const response = createMockResponse();

    await handleJobsHeartbeat(request, response.response as any);

    expect(response.response.statusCode).toBe(200);
    expect(JSON.parse(response.readBody())).toMatchObject({
      ok: true,
      acknowledged: true,
      status: "running",
      job_id: "job-1",
      claim_id: "claim-1",
      summary: "Heartbeat accepted."
    });
    expect(mockState.heartbeatJob).toHaveBeenCalledWith(
      expect.objectContaining({
        worker_id: "worker-1",
        job_id: "job-1",
        claim_id: "claim-1",
        status: "running",
        heartbeat_at: expect.any(String)
      })
    );
  });

  it("rejects invalid payloads", async () => {
    const request = Readable.from([
      JSON.stringify({
        job_id: "job-1",
        claim_id: "claim-1"
      })
    ]) as any;
    const response = createMockResponse();

    await handleJobsHeartbeat(request, response.response as any);

    expect(response.response.statusCode).toBe(400);
    expect(JSON.parse(response.readBody())).toMatchObject({
      ok: false,
      error: "Invalid job heartbeat payload."
    });
    expect(mockState.heartbeatJob).not.toHaveBeenCalled();
  });
});
