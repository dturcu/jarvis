import { describe, expect, it } from "vitest";
import { LessonInjector, KnowledgeStore } from "@jarvis/agent-framework";

describe("LessonInjector", () => {
  function createStoreWithLessons() {
    const store = new KnowledgeStore();
    store.addDocument({
      collection: "lessons",
      title: "[bd-pipeline] Run completed in 4 steps",
      content: "Agent run completed successfully. Goal: identify new prospects. Steps: 4/4.",
      tags: ["bd-pipeline", "completion"],
    });
    store.addDocument({
      collection: "lessons",
      title: "[bd-pipeline] Run failed: timeout on LinkedIn search",
      content: "Agent run failed after 2 steps. Error: timeout. Investigate before next run.",
      tags: ["bd-pipeline", "failure"],
    });
    store.addDocument({
      collection: "iso26262",
      title: "[evidence-auditor] Found 3 gaps in FMEA",
      content: "FMEA work product missing traceability to safety goals for ASIL-D items.",
      tags: ["evidence-auditor", "gap"],
    });
    return store;
  }

  it("returns lessons for matching agent and collection", () => {
    const store = createStoreWithLessons();
    const injector = new LessonInjector(store);

    const context = injector.buildLessonsContext("bd-pipeline", "scan for new prospects");
    expect(context).toContain("LESSONS LEARNED");
    expect(context).toContain("bd-pipeline");
  });

  it("returns empty string when no lessons match", () => {
    const store = new KnowledgeStore();
    const injector = new LessonInjector(store);

    const context = injector.buildLessonsContext("portfolio-monitor", "check crypto prices");
    expect(context).toBe("");
  });

  it("matches evidence-auditor to iso26262 collection", () => {
    const store = createStoreWithLessons();
    const injector = new LessonInjector(store);

    const context = injector.buildLessonsContext("evidence-auditor", "scan for FMEA gaps");
    expect(context).toContain("LESSONS LEARNED");
    expect(context).toContain("evidence-auditor");
  });

  it("respects maxLessons parameter", () => {
    const store = createStoreWithLessons();
    const injector = new LessonInjector(store);

    const context = injector.buildLessonsContext("bd-pipeline", "scan for prospects", 1);
    const lines = context.split("\n").filter((l) => l.startsWith("- "));
    expect(lines.length).toBeLessThanOrEqual(1);
  });

  it("truncates long lesson content", () => {
    const store = new KnowledgeStore();
    const longContent = "A".repeat(500);
    store.addDocument({
      collection: "lessons",
      title: "Long lesson",
      content: longContent,
      tags: ["bd-pipeline"],
    });
    const injector = new LessonInjector(store);

    const context = injector.buildLessonsContext("bd-pipeline", "test goal with long content");
    expect(context).toContain("...");
  });
});
