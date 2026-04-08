import { describe, expect, it, afterEach } from "vitest";
import { SparseStore, reciprocalRankFusion } from "@jarvis/agent-framework";

describe("SparseStore", () => {
  let store: SparseStore;

  afterEach(() => {
    store?.close();
  });

  it("indexes and searches documents by keyword", () => {
    store = new SparseStore(":memory:");
    store.addChunks("doc-1", [
      { id: "c1", text: "ISO 26262 functional safety standard for automotive" },
      { id: "c2", text: "ASPICE process improvement model for software development" },
    ]);

    const results = store.search("automotive safety", 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].docId).toBe("doc-1");
  });

  it("filters by collection", () => {
    store = new SparseStore(":memory:");
    store.addChunks("doc-1", [{ id: "c1", text: "safety standard automotive" }], "iso26262");
    store.addChunks("doc-2", [{ id: "c2", text: "safety analysis hazard" }], "lessons");

    const filtered = store.search("safety", 5, "iso26262");
    expect(filtered).toHaveLength(1);
    expect(filtered[0].docId).toBe("doc-1");
  });

  it("deletes chunks for a document", () => {
    store = new SparseStore(":memory:");
    store.addChunks("doc-1", [{ id: "c1", text: "automotive compliance" }]);
    store.deleteChunks("doc-1");

    const results = store.search("automotive", 5);
    expect(results).toHaveLength(0);
  });

  it("returns empty for empty query", () => {
    store = new SparseStore(":memory:");
    store.addChunks("doc-1", [{ id: "c1", text: "test content" }]);
    expect(store.search("", 5)).toHaveLength(0);
    expect(store.search("   ", 5)).toHaveLength(0);
  });

  it("scores are positive (higher = better)", () => {
    store = new SparseStore(":memory:");
    store.addChunks("doc-1", [
      { id: "c1", text: "automotive safety ISO 26262 functional safety" },
      { id: "c2", text: "garden tomato planting schedule" },
    ]);

    const results = store.search("automotive safety", 5);
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.score).toBeGreaterThan(0);
    }
  });
});

describe("reciprocalRankFusion", () => {
  it("fuses results from both lists", () => {
    const dense = [
      { text: "A", score: 0.95, docId: "d1" },
      { text: "B", score: 0.85, docId: "d2" },
    ];
    const sparse = [
      { text: "B", score: 5.0, docId: "d2" },
      { text: "C", score: 3.0, docId: "d3" },
    ];

    const fused = reciprocalRankFusion(dense, sparse, 60, 5);
    expect(fused.length).toBe(3);
    // B appears in both lists, should have highest fused score
    expect(fused[0].text).toBe("B");
  });

  it("respects topK limit", () => {
    const items = Array.from({ length: 10 }, (_, i) => ({
      text: `item-${i}`,
      score: 10 - i,
      docId: `d${i}`,
    }));
    const fused = reciprocalRankFusion(items, [], 60, 3);
    expect(fused).toHaveLength(3);
  });

  it("handles empty inputs", () => {
    expect(reciprocalRankFusion([], [], 60, 5)).toHaveLength(0);
    expect(reciprocalRankFusion([], [{ text: "A", score: 1, docId: "d1" }], 60, 5)).toHaveLength(1);
  });
});
