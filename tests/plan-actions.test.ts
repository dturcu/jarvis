import { describe, expect, it } from "vitest";
import { getAvailableJobTypes, normalizePlannedStep } from "../packages/jarvis-runtime/src/plan-actions.js";

describe("plan action normalization", () => {
  it("exposes only concrete job types for an agent capability set", () => {
    const jobTypes = getAvailableJobTypes(["inference", "web", "device"]);

    expect(jobTypes).toContain("inference.chat");
    expect(jobTypes).toContain("web.search_news");
    expect(jobTypes).toContain("device.notify");
    expect(jobTypes).not.toContain("database.query" as never);
  });

  it("rewrites invented inference-style actions into inference.chat with messages", () => {
    const step = normalizePlannedStep({
      step: 1,
      action: "database.query",
      input: { query: "recent failures by agent" },
      reasoning: "Summarize the last 7 days of failures",
    }, ["inference", "device"]);

    expect(step).toMatchObject({
      step: 1,
      action: "inference.chat",
    });
    expect(Array.isArray(step?.input.messages)).toBe(true);
    expect(step?.input.messages).toHaveLength(1);
    expect(step?.input.messages?.[0]).toMatchObject({ role: "user" });
  });

  it("rewrites telegram notifications into device.notify payloads", () => {
    const step = normalizePlannedStep({
      step: 1,
      action: "telegram.send_notification",
      input: { message: "Health check finished" },
      reasoning: "Notify the operator locally",
    }, ["device"]);

    expect(step).toMatchObject({
      action: "device.notify",
      input: {
        title: "Jarvis",
        body: "Health check finished",
      },
    });
  });

  it("normalizes web.search_news queries and rejects empty document ingest steps", () => {
    const newsStep = normalizePlannedStep({
      step: 1,
      action: "web.search_news",
      input: { q: "ISO 26262 draft revision" },
      reasoning: "",
    }, ["web"]);

    expect(newsStep).toMatchObject({
      action: "web.search_news",
      input: { query: "ISO 26262 draft revision" },
    });

    const ingestStep = normalizePlannedStep({
      step: 2,
      action: "document.ingest",
      input: {},
      reasoning: "Ingest the latest report",
    }, ["document"]);

    expect(ingestStep).toBeNull();
  });

  it("drops unsupported invented actions instead of executing them", () => {
    const step = normalizePlannedStep({
      step: 1,
      action: "entity.merge",
      input: { source: "a", target: "b" },
      reasoning: "Merge duplicate entities",
    }, ["inference", "device"]);

    expect(step).toBeNull();
  });
});
