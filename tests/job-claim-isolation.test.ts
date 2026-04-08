import { beforeEach, describe, expect, it } from "vitest";
import { getJarvisState, resetJarvisState } from "@jarvis/shared";

describe("Job claim isolation", () => {
  beforeEach(() => {
    resetJarvisState();
  });

  it("does not hand a pinned run_group job to a worker that omits run_group", () => {
    getJarvisState().submitJob({
      type: "office.preview",
      input: {
        source_artifact: { artifact_id: "a1" },
        format: "pdf",
        output_name: "preview.pdf",
      },
      runGroup: "main",
    });

    const claim = getJarvisState().claimJob({
      worker_id: "office-worker-1",
      routes: ["office"],
    });

    expect(claim).toBeNull();
  });

  it("still allows the matching run_group to claim the job", () => {
    const queued = getJarvisState().submitJob({
      type: "office.preview",
      input: {
        source_artifact: { artifact_id: "a1" },
        format: "pdf",
        output_name: "preview.pdf",
      },
      runGroup: "main",
    });

    const claim = getJarvisState().claimJob({
      worker_id: "office-worker-1",
      routes: ["office"],
      run_group: "main",
    });

    expect(claim?.job_id).toBe(queued.job_id);
  });
});
