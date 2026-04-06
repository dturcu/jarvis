import { beforeEach, describe, expect, it } from "vitest";
import { CONTRACT_VERSION, type JobEnvelope } from "@jarvis/shared";
import {
  createDefaultCompletedResult,
  createJarvisSupervisor,
  getSupervisorRoutes,
  type SupervisorRoute
} from "../packages/jarvis-supervisor/src/index.ts";

function makeJob(type: string): JobEnvelope {
  return {
    contract_version: CONTRACT_VERSION,
    job_id: `${type}-job`,
    type: type as JobEnvelope["type"],
    session_key: "agent:main:telegram:dm:123",
    requested_by: {
      channel: "telegram",
      user_id: "123456789"
    },
    priority: "normal",
    approval_state: "approved",
    timeout_seconds: 60,
    attempt: 1,
    input: {},
    artifacts_in: [],
    metadata: {
      agent_id: "main",
      thread_key: null
    }
  };
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {})
    }
  });
}

function createEndpointFetchMock(options: {
  claim: Response | (() => Response | Promise<Response>);
  heartbeat?: Response | (() => Response | Promise<Response>);
  callback: Response | (() => Response | Promise<Response>);
}) {
  const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
  let claimed = false;
  let callbackSent = false;

  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ input, init });
    const pathname = new URL(String(input)).pathname;

    if (pathname.endsWith("/jarvis/jobs/claim")) {
      if (claimed) {
        return new Response("", { status: 204 });
      }
      claimed = true;
      return typeof options.claim === "function"
        ? await options.claim()
        : options.claim;
    }

    if (pathname.endsWith("/jarvis/jobs/heartbeat")) {
      const heartbeat = options.heartbeat ?? new Response("", { status: 200 });
      return typeof heartbeat === "function" ? await heartbeat() : heartbeat;
    }

    if (pathname.endsWith("/jarvis/jobs/callback")) {
      if (callbackSent) {
        throw new Error("Unexpected duplicate callback.");
      }
      callbackSent = true;
      return typeof options.callback === "function"
        ? await options.callback()
        : options.callback;
    }

    throw new Error(`Unexpected fetch path: ${pathname}`);
  };

  return { fetchImpl, calls };
}

describe("Jarvis supervisor", () => {
  beforeEach(() => {
    // no shared state to reset; each test uses mocked fetch only
  });

  it("routes a claimed job, heartbeats while running, and posts a completed callback", async () => {
    const job = makeJob("office.preview");
    const { fetchImpl, calls } = createEndpointFetchMock({
      claim: jsonResponse({
        ok: true,
        claim_id: "claim-1",
        lease_expires_at: "2026-04-04T12:00:10.000Z",
        job
      }),
      callback: jsonResponse({ ok: true })
    });

    const supervisor = createJarvisSupervisor({
      jobsBaseUrl: "http://127.0.0.1:19191",
      workerId: "supervisor-1",
      fetchImpl,
      heartbeatIntervalMs: 5,
      handlers: {
        office: async ({ job: claimedJob, heartbeat, route }) => {
          expect(route).toBe("office" satisfies SupervisorRoute);
          await heartbeat();
          await new Promise((resolve) => setTimeout(resolve, 20));
          return createDefaultCompletedResult(claimedJob, "supervisor-1", "Preview generated", {
            job_id: claimedJob.job_id
          });
        }
      }
    });

    const outcome = await supervisor.pollOnce();

    expect(outcome.kind).toBe("completed");
    expect(outcome.result.status).toBe("completed");
    expect(calls.length).toBeGreaterThanOrEqual(3);
    expect(String(calls[0].input)).toContain("/jarvis/jobs/claim");
    expect(calls.some((call) => String(call.input).includes("/jarvis/jobs/heartbeat"))).toBe(true);
    expect(String(calls.at(-1)?.input)).toContain("/jarvis/jobs/callback");

    const callbackInit = calls.at(-1)?.init;
    const callbackBody = JSON.parse(String(callbackInit?.body));
    expect(callbackBody).toMatchObject({
      contract_version: CONTRACT_VERSION,
      job_id: job.job_id,
      job_type: job.type,
      status: "completed",
      worker_id: "supervisor-1"
    });
  });

  it("posts a failed callback when a route handler throws", async () => {
    const job = makeJob("python.analyze");
    const { fetchImpl, calls } = createEndpointFetchMock({
      claim: jsonResponse({
        ok: true,
        claim: {
          claim_id: "claim-2",
          job
        }
      }),
      callback: jsonResponse({ ok: true })
    });

    const supervisor = createJarvisSupervisor({
      jobsBaseUrl: "http://127.0.0.1:19191",
      workerId: "supervisor-2",
      fetchImpl,
      heartbeatIntervalMs: 5,
      handlers: {
        python: async () => {
          throw new Error("analysis failed");
        }
      }
    });

    const outcome = await supervisor.pollOnce();

    expect(outcome.kind).toBe("failed");
    expect(outcome.result.status).toBe("failed");
    expect(calls.length).toBeGreaterThanOrEqual(2);

    const callbackBody = JSON.parse(String(calls.at(-1)?.init?.body));
    expect(callbackBody).toMatchObject({
      job_id: job.job_id,
      job_type: job.type,
      status: "failed",
      worker_id: "supervisor-2"
    });
    expect(callbackBody.error).toMatchObject({
      code: "HANDLER_FAILED",
      retryable: true
    });
  });

  it("reports idle when no job is available", async () => {
    const { fetchImpl, calls } = createEndpointFetchMock({
      claim: new Response(null, { status: 204 }),
      callback: jsonResponse({ ok: true })
    });

    const supervisor = createJarvisSupervisor({
      jobsBaseUrl: "http://127.0.0.1:19191",
      fetchImpl,
      handlers: {}
    });

    const outcome = await supervisor.pollOnce();

    expect(outcome.kind).toBe("idle");
    expect(calls).toHaveLength(1);
  });

  it("exposes the supervised route prefixes", () => {
    expect(getSupervisorRoutes()).toEqual(["device", "office", "python", "browser", "system", "inference", "security", "interpreter", "voice", "agent", "calendar", "email", "web", "crm", "document"]);
  });
});
