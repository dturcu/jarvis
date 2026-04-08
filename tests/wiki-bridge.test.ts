/**
 * Unit tests for WikiBridge sync rules and compliance boundary (Epics 9-10).
 *
 * Tests focus on the sync/block rules and configuration rather than
 * gateway connectivity (which requires a running OpenClaw gateway).
 */

import { describe, it, expect } from "vitest";
import {
  GatewayWikiBridge,
  DEFAULT_WIKI_SYNC_CONFIG,
  DEFAULT_WIKI_RETRIEVAL_CONFIG,
  type WikiSyncConfig,
  type KnowledgeDocument,
} from "@jarvis/agent-framework";

function makeDoc(overrides: Partial<KnowledgeDocument> = {}): KnowledgeDocument {
  return {
    doc_id: "test-doc-1",
    title: "Test Document",
    content: "Test content",
    tags: ["test"],
    collection: "lessons",
    created_at: "2026-04-08",
    ...overrides,
  };
}

describe("WikiBridge sync rules", () => {
  it("default sync config allows lessons, playbooks, case-studies, regulatory, garden", () => {
    const config = DEFAULT_WIKI_SYNC_CONFIG;
    expect(config.sync_collections).toContain("lessons");
    expect(config.sync_collections).toContain("playbooks");
    expect(config.sync_collections).toContain("case-studies");
    expect(config.sync_collections).toContain("regulatory");
    expect(config.sync_collections).toContain("garden");
  });

  it("default sync config blocks compliance collections", () => {
    const config = DEFAULT_WIKI_SYNC_CONFIG;
    expect(config.blocked_collections).toContain("contracts");
    expect(config.blocked_collections).toContain("iso26262");
    expect(config.blocked_collections).toContain("aspice");
    expect(config.blocked_collections).toContain("cybersecurity");
    expect(config.blocked_collections).toContain("signed_records");
    expect(config.blocked_collections).toContain("safety_case");
    expect(config.blocked_collections).toContain("audit_trail");
  });

  it("rejects publishing compliance-grade collections", async () => {
    const bridge = new GatewayWikiBridge();

    for (const collection of ["contracts", "iso26262", "aspice", "cybersecurity", "signed_records"]) {
      const doc = makeDoc({ collection });
      await expect(bridge.publish(doc)).rejects.toThrow("compliance-grade");
    }
  });

  it("rejects publishing collections not in sync whitelist", async () => {
    const bridge = new GatewayWikiBridge();
    const doc = makeDoc({ collection: "unknown_collection" });
    await expect(bridge.publish(doc)).rejects.toThrow("not in the sync whitelist");
  });

  it("getSyncConfig returns a copy of the config", () => {
    const bridge = new GatewayWikiBridge();
    const config1 = bridge.getSyncConfig();
    const config2 = bridge.getSyncConfig();
    expect(config1).toEqual(config2);
    expect(config1).not.toBe(config2); // different object references
  });

  it("custom sync config is respected", () => {
    const custom: WikiSyncConfig = {
      enabled: true,
      sync_collections: ["lessons"],
      blocked_collections: ["contracts"],
    };
    const bridge = new GatewayWikiBridge(custom);
    const config = bridge.getSyncConfig();
    expect(config.sync_collections).toEqual(["lessons"]);
    expect(config.blocked_collections).toEqual(["contracts"]);
  });
});

describe("WikiRetrievalConfig", () => {
  it("is disabled by default (weight = 0)", () => {
    expect(DEFAULT_WIKI_RETRIEVAL_CONFIG.weight).toBe(0);
    expect(DEFAULT_WIKI_RETRIEVAL_CONFIG.enabled).toBe(false);
  });

  it("has default max_results of 5", () => {
    expect(DEFAULT_WIKI_RETRIEVAL_CONFIG.max_results).toBe(5);
  });
});

describe("GatewayWikiBridge graceful degradation", () => {
  it("query returns empty array when gateway unavailable", async () => {
    const bridge = new GatewayWikiBridge();
    // No gateway running — should return empty, not throw
    const results = await bridge.query("test query");
    expect(results).toEqual([]);
  });

  it("status returns unavailable when gateway not running", async () => {
    const bridge = new GatewayWikiBridge();
    const health = await bridge.status();
    expect(health.available).toBe(false);
    expect(health.page_count).toBe(0);
  });

  it("sync returns error when gateway unavailable", async () => {
    const bridge = new GatewayWikiBridge();
    const result = await bridge.sync("2026-04-01");
    expect(result.pages_created).toBe(0);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
