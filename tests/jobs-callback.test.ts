import { Readable } from "node:stream";
import { beforeEach, describe, expect, it } from "vitest";
import { handleJobsCallback } from "@jarvis/jobs";
import {
  getJarvisState,
  resetJarvisState
} from "@jarvis/shared";

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

describe("Jarvis jobs callback route", () => {
  beforeEach(() => {
    resetJarvisState();
  });

  it("is idempotent for duplicate worker callbacks on the same attempt", async () => {
    const queued = getJarvisState().submitJob({
      type: "office.preview",
      input: {
        source_artifact: { artifact_id: "a1" },
        format: "pdf",
        output_name: "preview.pdf"
      },
      artifactsIn: [{ artifact_id: "a1" }]
    });
    const claim = getJarvisState().claimJob({
      worker_id: "office-worker-1",
      routes: ["office"],
    });
    expect(claim?.claim_id).toBeTruthy();

    const callbackPayload = {
      contract_version: "jarvis.v1" as const,
      job_id: queued.job_id!,
      job_type: "office.preview" as const,
      attempt: 1,
      status: "completed" as const,
      summary: "Rendered preview.pdf",
      worker_id: "office-worker-1",
      claim_id: claim!.claim_id!,
      artifacts: [
        {
          artifact_id: "preview-1",
          kind: "pdf",
          name: "preview.pdf",
          path: "/data/artifacts/preview.pdf",
          path_context: "worker_fs",
          path_style: "posix"
        }
      ]
    };

    const firstReq = Readable.from([JSON.stringify(callbackPayload)]) as any;
    const firstRes = createMockResponse();
    await handleJobsCallback(firstReq, firstRes.response as any);

    expect(firstRes.response.statusCode).toBe(200);
    expect(JSON.parse(firstRes.readBody())).toMatchObject({
      ok: true,
      job_id: queued.job_id,
      status: "completed"
    });

    const secondReq = Readable.from([JSON.stringify(callbackPayload)]) as any;
    const secondRes = createMockResponse();
    await handleJobsCallback(secondReq, secondRes.response as any);

    expect(secondRes.response.statusCode).toBe(200);
    expect(JSON.parse(secondRes.readBody())).toMatchObject({
      ok: true,
      job_id: queued.job_id,
      status: "completed"
    });

    const job = getJarvisState().getJob(queued.job_id!);
    expect(job.artifacts).toEqual(callbackPayload.artifacts);
    expect(job.summary).toBe("Rendered preview.pdf");
  });

  it("rejects callbacks whose claim_id does not match the active claim", async () => {
    const queued = getJarvisState().submitJob({
      type: "office.preview",
      input: {
        source_artifact: { artifact_id: "a1" },
        format: "pdf",
        output_name: "preview.pdf"
      },
      artifactsIn: [{ artifact_id: "a1" }]
    });
    const claim = getJarvisState().claimJob({
      worker_id: "office-worker-1",
      routes: ["office"],
    });
    expect(claim?.claim_id).toBeTruthy();

    const request = Readable.from([JSON.stringify({
      contract_version: "jarvis.v1",
      job_id: queued.job_id,
      job_type: "office.preview",
      attempt: 1,
      status: "completed",
      summary: "Rendered preview.pdf",
      worker_id: "office-worker-1",
      claim_id: "wrong-claim-id"
    })]) as any;
    const response = createMockResponse();

    await handleJobsCallback(request, response.response as any);

    expect(response.response.statusCode).toBe(409);
    expect(JSON.parse(response.readBody())).toMatchObject({
      ok: false,
      error: expect.stringContaining("claim_id does not match"),
    });

    const job = getJarvisState().getJob(queued.job_id!);
    expect(job.status).toBe("in_progress");
  });
});
