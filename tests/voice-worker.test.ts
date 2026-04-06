import { beforeEach, describe, expect, it } from "vitest";
import {
  CONTRACT_VERSION,
  resetJarvisState
} from "@jarvis/shared";
import {
  MockVoiceAdapter,
  createMockVoiceAdapter,
  createVoiceWorker,
  executeVoiceJob,
  isVoiceJobType,
  VOICE_JOB_TYPES
} from "@jarvis/voice-worker";
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
    timeout_seconds: 30,
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

describe("VOICE_JOB_TYPES", () => {
  it("contains all 5 voice job types", () => {
    expect(VOICE_JOB_TYPES).toHaveLength(5);
    expect(VOICE_JOB_TYPES).toContain("voice.listen");
    expect(VOICE_JOB_TYPES).toContain("voice.transcribe");
    expect(VOICE_JOB_TYPES).toContain("voice.speak");
    expect(VOICE_JOB_TYPES).toContain("voice.wake_word_start");
    expect(VOICE_JOB_TYPES).toContain("voice.wake_word_stop");
  });
});

describe("isVoiceJobType", () => {
  it("returns true for known voice job types", () => {
    for (const type of VOICE_JOB_TYPES) {
      expect(isVoiceJobType(type)).toBe(true);
    }
  });

  it("returns false for non-voice job types", () => {
    expect(isVoiceJobType("system.monitor_cpu")).toBe(false);
    expect(isVoiceJobType("device.snapshot")).toBe(false);
    expect(isVoiceJobType("unknown.job")).toBe(false);
    expect(isVoiceJobType("")).toBe(false);
  });
});

describe("MockVoiceAdapter", () => {
  let adapter: MockVoiceAdapter;

  beforeEach(() => {
    adapter = new MockVoiceAdapter();
  });

  describe("listen", () => {
    it("returns an audio artifact with correct format", async () => {
      const result = await adapter.listen({ duration_seconds: 5 });
      expect(result.summary).toContain("5s");
      expect(result.structured_output.format).toBe("wav");
      expect(result.structured_output.sample_rate).toBe(16000);
      expect(result.structured_output.duration_seconds).toBe(5);
      expect(result.structured_output.audio_artifact_id).toMatch(/^audio-/);
    });

    it("records the call", async () => {
      await adapter.listen({ duration_seconds: 3, device_id: "mic-1" });
      const calls = adapter.getListenCalls();
      expect(calls).toHaveLength(1);
      expect(calls[0]!.duration_seconds).toBe(3);
      expect(calls[0]!.device_id).toBe("mic-1");
    });

    it("uses 'default' when device_id is not provided", async () => {
      const result = await adapter.listen({ duration_seconds: 2 });
      expect(result.summary).toContain("default");
    });
  });

  describe("transcribe", () => {
    it("returns transcription with segments and confidence", async () => {
      const result = await adapter.transcribe({
        audio_artifact_id: "audio-abc",
        language: "en",
        model: "base"
      });
      expect(result.structured_output.text).toBeTruthy();
      expect(result.structured_output.language).toBe("en");
      expect(result.structured_output.confidence).toBeGreaterThan(0);
      expect(result.structured_output.confidence).toBeLessThanOrEqual(1);
      expect(Array.isArray(result.structured_output.segments)).toBe(true);
      expect(result.structured_output.segments.length).toBeGreaterThan(0);
    });

    it("segment has start, end, text fields", async () => {
      const result = await adapter.transcribe({ audio_artifact_id: "audio-test" });
      const seg = result.structured_output.segments[0]!;
      expect(typeof seg.start).toBe("number");
      expect(typeof seg.end).toBe("number");
      expect(typeof seg.text).toBe("string");
    });

    it("records the call", async () => {
      await adapter.transcribe({ audio_artifact_id: "audio-xyz" });
      const calls = adapter.getTranscribeCalls();
      expect(calls).toHaveLength(1);
      expect(calls[0]!.audio_artifact_id).toBe("audio-xyz");
    });

    it("defaults language to en when not specified", async () => {
      const result = await adapter.transcribe({ audio_artifact_id: "audio-x" });
      expect(result.structured_output.language).toBe("en");
    });
  });

  describe("speak", () => {
    it("returns a TTS audio artifact", async () => {
      const result = await adapter.speak({ text: "Hello, world!" });
      expect(result.structured_output.audio_artifact_id).toMatch(/^tts-/);
      expect(result.structured_output.format).toBe("wav");
      expect(result.structured_output.duration_seconds).toBeGreaterThan(0);
      expect(result.structured_output.voice).toBeTruthy();
    });

    it("uses the provided voice", async () => {
      const result = await adapter.speak({ text: "Test", voice: "en_GB-alan-medium" });
      expect(result.structured_output.voice).toBe("en_GB-alan-medium");
    });

    it("summary mentions character count", async () => {
      const text = "Hello";
      const result = await adapter.speak({ text });
      expect(result.summary).toContain(`${text.length} characters`);
    });

    it("records the call", async () => {
      await adapter.speak({ text: "Test speech", speed: 1.5 });
      const calls = adapter.getSpeakCalls();
      expect(calls).toHaveLength(1);
      expect(calls[0]!.text).toBe("Test speech");
      expect(calls[0]!.speed).toBe(1.5);
    });
  });

  describe("wakeWordStart", () => {
    it("returns a session with listening=true", async () => {
      const result = await adapter.wakeWordStart({ keyword: "jarvis", sensitivity: 0.5 });
      expect(result.structured_output.listening).toBe(true);
      expect(result.structured_output.keyword).toBe("jarvis");
      expect(result.structured_output.session_id).toMatch(/^ww-/);
    });

    it("stores the active session ID", async () => {
      expect(adapter.getActiveSessionId()).toBeNull();
      await adapter.wakeWordStart({ keyword: "jarvis", sensitivity: 0.6 });
      expect(adapter.getActiveSessionId()).not.toBeNull();
    });

    it("records the call", async () => {
      await adapter.wakeWordStart({ keyword: "hey", sensitivity: 0.8 });
      const calls = adapter.getWakeWordStartCalls();
      expect(calls).toHaveLength(1);
      expect(calls[0]!.keyword).toBe("hey");
      expect(calls[0]!.sensitivity).toBe(0.8);
    });
  });

  describe("wakeWordStop", () => {
    it("returns stopped=true", async () => {
      await adapter.wakeWordStart({ keyword: "jarvis", sensitivity: 0.5 });
      const result = await adapter.wakeWordStop({});
      expect(result.structured_output.stopped).toBe(true);
      expect(result.structured_output.session_id).toBeTruthy();
    });

    it("clears the active session", async () => {
      await adapter.wakeWordStart({ keyword: "jarvis", sensitivity: 0.5 });
      await adapter.wakeWordStop({});
      expect(adapter.getActiveSessionId()).toBeNull();
    });

    it("records stop count", async () => {
      expect(adapter.getWakeWordStopCount()).toBe(0);
      await adapter.wakeWordStop({});
      await adapter.wakeWordStop({});
      expect(adapter.getWakeWordStopCount()).toBe(2);
    });
  });
});

describe("executeVoiceJob", () => {
  let adapter: MockVoiceAdapter;

  beforeEach(() => {
    resetJarvisState();
    adapter = new MockVoiceAdapter();
  });

  it("executes voice.listen and returns completed result", async () => {
    const envelope = makeEnvelope("voice.listen", { duration_seconds: 5 });
    const result = await executeVoiceJob(envelope, adapter);

    expect(result.contract_version).toBe(CONTRACT_VERSION);
    expect(result.job_id).toBe(envelope.job_id);
    expect(result.job_type).toBe("voice.listen");
    expect(result.status).toBe("completed");
    expect(result.attempt).toBe(1);
    const out = result.structured_output as Record<string, unknown>;
    expect(out.format).toBe("wav");
    expect(out.sample_rate).toBe(16000);
    expect(result.metrics?.worker_id).toBe("voice-worker");
  });

  it("executes voice.transcribe and returns completed result", async () => {
    const envelope = makeEnvelope("voice.transcribe", {
      audio_artifact_id: "audio-test",
      language: "en",
      model: "base"
    });
    const result = await executeVoiceJob(envelope, adapter);

    expect(result.status).toBe("completed");
    expect(result.job_type).toBe("voice.transcribe");
    const out = result.structured_output as Record<string, unknown>;
    expect(typeof out.text).toBe("string");
    expect(typeof out.confidence).toBe("number");
    expect(Array.isArray(out.segments)).toBe(true);
  });

  it("executes voice.speak and returns completed result", async () => {
    const envelope = makeEnvelope("voice.speak", {
      text: "Hello, world!",
      voice: "en_US-lessac-medium"
    });
    const result = await executeVoiceJob(envelope, adapter);

    expect(result.status).toBe("completed");
    expect(result.job_type).toBe("voice.speak");
    const out = result.structured_output as Record<string, unknown>;
    expect(typeof out.audio_artifact_id).toBe("string");
    expect(out.format).toBe("wav");
  });

  it("executes voice.wake_word_start and returns completed result", async () => {
    const envelope = makeEnvelope("voice.wake_word_start", {
      keyword: "jarvis",
      sensitivity: 0.5
    });
    const result = await executeVoiceJob(envelope, adapter);

    expect(result.status).toBe("completed");
    expect(result.job_type).toBe("voice.wake_word_start");
    const out = result.structured_output as Record<string, unknown>;
    expect(out.listening).toBe(true);
    expect(out.keyword).toBe("jarvis");
  });

  it("executes voice.wake_word_stop and returns completed result", async () => {
    await adapter.wakeWordStart({ keyword: "jarvis", sensitivity: 0.5 });
    const envelope = makeEnvelope("voice.wake_word_stop", {});
    const result = await executeVoiceJob(envelope, adapter);

    expect(result.status).toBe("completed");
    expect(result.job_type).toBe("voice.wake_word_stop");
    const out = result.structured_output as Record<string, unknown>;
    expect(out.stopped).toBe(true);
  });

  it("returns failed status for unsupported job type", async () => {
    const envelope = makeEnvelope("system.monitor_cpu", {});
    const result = await executeVoiceJob(envelope, adapter);

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("INVALID_INPUT");
    expect(result.error?.message).toContain("system.monitor_cpu");
    expect(result.error?.retryable).toBe(false);
  });

  it("wraps TypeError from adapter into INVALID_INPUT error", async () => {
    const faultyAdapter = new MockVoiceAdapter();
    faultyAdapter.listen = async (_input) => {
      const obj = null as unknown as { foo: string };
      void obj.foo;
      throw new Error("unreachable");
    };

    const envelope = makeEnvelope("voice.listen", { duration_seconds: 5 });
    const result = await executeVoiceJob(envelope, faultyAdapter);

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("INVALID_INPUT");
  });

  it("wraps generic Error into INTERNAL_ERROR", async () => {
    const faultyAdapter = new MockVoiceAdapter();
    faultyAdapter.speak = async () => {
      throw new Error("TTS engine crashed");
    };

    const envelope = makeEnvelope("voice.speak", { text: "test" });
    const result = await executeVoiceJob(envelope, faultyAdapter);

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("INTERNAL_ERROR");
    expect(result.error?.message).toBe("TTS engine crashed");
  });

  it("uses custom workerId when provided", async () => {
    const envelope = makeEnvelope("voice.listen", { duration_seconds: 2 });
    const result = await executeVoiceJob(envelope, adapter, {
      workerId: "my-voice-worker"
    });

    expect(result.status).toBe("completed");
    expect(result.metrics?.worker_id).toBe("my-voice-worker");
  });
});

describe("createVoiceWorker", () => {
  beforeEach(() => {
    resetJarvisState();
  });

  it("exposes a default workerId", () => {
    const worker = createVoiceWorker({ adapter: createMockVoiceAdapter() });
    expect(worker.workerId).toBe("voice-worker");
  });

  it("uses the provided workerId", () => {
    const worker = createVoiceWorker({
      adapter: createMockVoiceAdapter(),
      workerId: "custom-voice-worker"
    });
    expect(worker.workerId).toBe("custom-voice-worker");
  });

  it("executes a job via the worker facade", async () => {
    const worker = createVoiceWorker({ adapter: createMockVoiceAdapter() });
    const envelope = makeEnvelope("voice.listen", { duration_seconds: 3 });
    const result = await worker.execute(envelope);

    expect(result.status).toBe("completed");
    expect(result.metrics?.worker_id).toBe("voice-worker");
    const out = result.structured_output as Record<string, unknown>;
    expect(out.format).toBe("wav");
  });

  it("routes all 5 voice job types correctly", async () => {
    const worker = createVoiceWorker({ adapter: createMockVoiceAdapter() });
    const jobSpecs: Array<[string, Record<string, unknown>]> = [
      ["voice.listen", { duration_seconds: 1 }],
      ["voice.transcribe", { audio_artifact_id: "audio-x" }],
      ["voice.speak", { text: "hi" }],
      ["voice.wake_word_start", { keyword: "jarvis", sensitivity: 0.5 }],
      ["voice.wake_word_stop", {}]
    ];

    for (const [type, input] of jobSpecs) {
      const envelope = makeEnvelope(type, input);
      const result = await worker.execute(envelope);
      expect(result.status).toBe("completed");
      expect(result.job_type).toBe(type);
    }
  });
});
