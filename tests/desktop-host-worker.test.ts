import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import {
  CONTRACT_VERSION,
  getJarvisState,
  resetJarvisState,
  submitDeviceOpenApp,
  type JobEnvelope
} from "@jarvis/shared";
import {
  createDesktopHostWorker,
  MockDesktopHostAdapter
} from "@jarvis/desktop-host-worker";

type ExampleFile = {
  job_envelope: JobEnvelope;
};

function readExampleEnvelope(name: string): JobEnvelope {
  const fileUrl = new URL(`../contracts/jarvis/v1/examples/${name}`, import.meta.url);
  const payload = JSON.parse(readFileSync(fileUrl, "utf8")) as ExampleFile;
  return payload.job_envelope;
}

function extractEnvelope(jobId: string): JobEnvelope {
  const response = getJarvisState().getJob(jobId);
  return (response.structured_output as {
    envelope: JobEnvelope;
  }).envelope;
}

describe("Desktop host worker", () => {
  beforeEach(() => {
    resetJarvisState();
  });

  it("executes a low-risk device snapshot job with canonical result fields", async () => {
    const worker = createDesktopHostWorker({
      adapter: new MockDesktopHostAdapter()
    });

    const result = await worker.execute(readExampleEnvelope("device.snapshot.json"));

    expect(result.contract_version).toBe(CONTRACT_VERSION);
    expect(result.job_type).toBe("device.snapshot");
    expect(result.status).toBe("completed");
    expect(result.metrics?.worker_id).toBe(worker.workerId);
    expect(result.metrics?.started_at).toBeTruthy();
    expect(result.metrics?.finished_at).toBeTruthy();
    expect((result.structured_output as Record<string, unknown>).host).toMatchObject({
      platform: "windows",
      hostname: "jarvis-workstation"
    });
  });

  it("blocks required device actions until approval is granted", async () => {
    const adapter = new MockDesktopHostAdapter();
    const worker = createDesktopHostWorker({ adapter });
    const envelope = {
      ...readExampleEnvelope("device.click.json"),
      approval_state: "pending" as const
    };

    const result = await worker.execute(envelope);

    expect(result.status).toBe("awaiting_approval");
    expect(result.error?.code).toBe("APPROVAL_REQUIRED");
    expect(adapter.getInputActions()).toHaveLength(0);
  });

  it("preserves screenshot artifacts with Windows path semantics", async () => {
    const worker = createDesktopHostWorker({
      adapter: new MockDesktopHostAdapter()
    });

    const result = await worker.execute(readExampleEnvelope("device.screenshot.json"));
    const artifact = result.artifacts?.[0];

    expect(result.status).toBe("completed");
    expect(artifact).toBeDefined();
    expect(artifact?.path_context).toBe("windows-host");
    expect(artifact?.path_style).toBe("windows");
    expect(artifact?.path).toContain("C:\\Jarvis\\artifacts\\");
    expect(
      (result.structured_output as Record<string, unknown>).capture_artifact_id,
    ).toBe(artifact?.artifact_id);
  });

  it("rejects non-device job envelopes", async () => {
    const worker = createDesktopHostWorker({
      adapter: new MockDesktopHostAdapter()
    });

    const result = await worker.execute(
      readExampleEnvelope("office.inspect.json") as JobEnvelope,
    );

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("INVALID_INPUT");
  });

  it("round-trips a completed worker result through the jobs callback path", async () => {
    const worker = createDesktopHostWorker({
      adapter: new MockDesktopHostAdapter()
    });

    const submitResponse = submitDeviceOpenApp(
      {
        agentId: "main",
        sessionKey: "agent:main:telegram:dm:123",
        messageChannel: "telegram",
        requesterSenderId: "123456789"
      } as any,
      {
        appId: "notepad",
        arguments: [],
        waitForWindow: true
      },
    );

    const envelope = extractEnvelope(submitResponse.job_id!);
    const result = await worker.execute(envelope);
    const callback = worker.toCallback(result);
    const finalResult = getJarvisState().handleWorkerCallback(callback);
    const jobResponse = getJarvisState().getJob(envelope.job_id);

    expect(finalResult.status).toBe("completed");
    expect(jobResponse.status).toBe("completed");
    expect(
      (
        (jobResponse.structured_output as {
          result: {
            structured_output: {
              app_id?: string;
              window?: {
                app_id?: string;
              };
            };
          };
        }).result.structured_output.window?.app_id
      ),
    ).toBe("notepad");
  });
});
