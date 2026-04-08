import type { KnowledgeCollection, KnowledgeSearchResult } from "./knowledge.js";
import { AGENT_DEFAULT_COLLECTION } from "./lesson-capture.js";

/**
 * Minimal interface satisfied by both KnowledgeStore and SqliteKnowledgeStore.
 */
export interface LessonSearchable {
  search(
    query: string,
    options?: { collection?: KnowledgeCollection; limit?: number },
  ): KnowledgeSearchResult[];
}

/**
 * Injects relevant lessons learned from prior agent runs into the system
 * prompt at plan time. This is runtime RAG over the lesson corpus — not
 * automated prompt rewriting.
 */
export class LessonInjector {
  constructor(private readonly store: LessonSearchable) {}

  /**
   * Build a lessons-learned context block for an agent run.
   *
   * @param agentId   - The agent that is about to run
   * @param goal      - The goal string for the upcoming run
   * @param maxLessons - Maximum number of lessons to include (default 5)
   * @returns A formatted string to prepend to the system prompt, or "" if no lessons match
   */
  buildLessonsContext(
    agentId: string,
    goal: string,
    maxLessons = 5,
  ): string {
    const collection = AGENT_DEFAULT_COLLECTION[agentId] ?? "lessons";

    // Build a search query from agent id + top goal keywords
    const goalKeywords = goal
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3)
      .slice(0, 5)
      .join(" ");
    const query = `${agentId} ${goalKeywords}`.trim();

    const results = this.store.search(query, {
      collection,
      limit: maxLessons,
    });

    if (results.length === 0) return "";

    const lines = results.map((r) => {
      const summary =
        r.doc.content.length > 200
          ? r.doc.content.slice(0, 200) + "..."
          : r.doc.content;
      return `- ${r.doc.title}: ${summary}`;
    });

    return `LESSONS LEARNED (from previous runs):\n${lines.join("\n")}`;
  }
}
