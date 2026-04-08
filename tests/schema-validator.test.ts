import { beforeEach, describe, expect, it } from "vitest";
import {
  getJarvisState,
  resetJarvisState,
  configureJarvisStatePersistence,
  validateJobInput
} from "@jarvis/shared";

describe("validateJobInput", () => {
  // -- Pass-through for unknown types --------------------------------------
  it("returns valid for job types without a registered schema", () => {
    // Cast to bypass the type system — simulates a future job type not yet
    // in the registry.
    const result = validateJobInput(
      "device.snapshot" as any,
      { whatever: true },
    );
    // device.snapshot has no registered schema, so it should pass through.
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  // -- Non-object inputs ---------------------------------------------------
  it("rejects null input", () => {
    const result = validateJobInput("email.search", null);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("input must be a non-null object");
  });

  it("rejects array input", () => {
    const result = validateJobInput("email.search", []);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("input must be a non-null object");
  });

  it("rejects string input", () => {
    const result = validateJobInput("email.search", "not an object");
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("input must be a non-null object");
  });

  // -- Required field checks -----------------------------------------------
  it("catches missing required fields for email.search", () => {
    const result = validateJobInput("email.search", {});
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('missing required field "query"');
  });

  it("catches missing required fields for crm.add_contact", () => {
    const result = validateJobInput("crm.add_contact", { name: "Alice" });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('missing required field "company"');
  });

  it("catches multiple missing required fields", () => {
    const result = validateJobInput("browser.capture", {});
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        'missing required field "target_url"',
        'missing required field "mode"',
        'missing required field "output_name"'
      ]),
    );
  });

  // -- Type checks ---------------------------------------------------------
  it("catches wrong type for string field", () => {
    const result = validateJobInput("email.search", { query: 42 });
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        'field "query" must be a string, got number'
      ]),
    );
  });

  it("catches wrong type for integer field", () => {
    const result = validateJobInput("email.search", {
      query: "test",
      max_results: "ten"
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        'field "max_results" must be an integer, got string'
      ]),
    );
  });

  it("catches non-integer number for integer field", () => {
    const result = validateJobInput("email.search", {
      query: "test",
      max_results: 3.5
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        'field "max_results" must be an integer, got non-integer number'
      ]),
    );
  });

  it("catches wrong type for boolean field", () => {
    const result = validateJobInput("email.read", {
      message_id: "msg-1",
      include_raw: "yes"
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        'field "include_raw" must be a boolean, got string'
      ]),
    );
  });

  it("catches wrong type for array field", () => {
    const result = validateJobInput("email.draft", {
      to: "alice@example.com",
      subject: "Hello",
      body: "Hi there"
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        'field "to" must be an array of strings, got string'
      ]),
    );
  });

  it("catches non-string elements in string[] field", () => {
    const result = validateJobInput("email.draft", {
      to: ["alice@example.com", 42],
      subject: "Hello",
      body: "Hi there"
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        'field "to[1]" must be a string, got number'
      ]),
    );
  });

  it("catches wrong type for array field (target_artifacts)", () => {
    const result = validateJobInput("office.inspect", {
      target_artifacts: "not-an-array"
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        'field "target_artifacts" must be an array, got string'
      ]),
    );
  });

  it("catches wrong type for object field", () => {
    const result = validateJobInput("office.transform_excel", {
      source_artifact: "not-an-object",
      output_name: "out.xlsx"
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        'field "source_artifact" must be an object, got string'
      ]),
    );
  });

  it("catches array where object is expected", () => {
    const result = validateJobInput("office.transform_excel", {
      source_artifact: [1, 2, 3],
      output_name: "out.xlsx"
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        'field "source_artifact" must be an object, got array'
      ]),
    );
  });

  // -- Valid payloads ------------------------------------------------------
  it("accepts valid email.search input", () => {
    const result = validateJobInput("email.search", {
      query: "from:boss@company.com"
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("accepts valid crm.add_contact input", () => {
    const result = validateJobInput("crm.add_contact", {
      name: "Alice",
      company: "ACME Corp",
      tags: ["iso26262", "aspice"]
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("accepts valid browser.capture input", () => {
    const result = validateJobInput("browser.capture", {
      target_url: "https://example.com",
      mode: "screenshot",
      output_name: "capture.png"
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("accepts valid agent.start input", () => {
    const result = validateJobInput("agent.start", {
      agent_id: "bd-pipeline",
      trigger_kind: "manual",
      goal: "scan for BD signals"
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("ignores optional fields that are not present", () => {
    const result = validateJobInput("email.search", {
      query: "is:unread"
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("accepts types with empty required arrays (email.list_threads)", () => {
    const result = validateJobInput("email.list_threads", {});
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

describe("submitJob validation integration", () => {
  beforeEach(() => {
    configureJarvisStatePersistence(null);
    resetJarvisState();
  });

  it("rejects a job with invalid input at submission time", () => {
    const response = getJarvisState().submitJob({
      type: "email.search",
      input: {}
    });
    expect(response.status).toBe("failed");
    expect(response.error?.code).toBe("INVALID_JOB_INPUT");
    expect(response.error?.message).toContain("missing required field");
    expect(response.error?.retryable).toBe(false);
  });

  it("rejects a job with wrong field types", () => {
    const response = getJarvisState().submitJob({
      type: "crm.add_contact",
      input: { name: 123, company: true }
    });
    expect(response.status).toBe("failed");
    expect(response.error?.code).toBe("INVALID_JOB_INPUT");
    expect(response.error?.message).toContain("must be a string");
  });

  it("accepts a job with valid input and queues it", () => {
    const response = getJarvisState().submitJob({
      type: "email.search",
      input: { query: "from:alice@example.com" }
    });
    expect(response.status).toBe("accepted");
    expect(response.job_id).toBeDefined();
  });

  it("passes through job types without schemas", () => {
    const response = getJarvisState().submitJob({
      type: "device.snapshot",
      input: { anything: "goes" }
    });
    expect(response.status).toBe("accepted");
    expect(response.job_id).toBeDefined();
  });
});
