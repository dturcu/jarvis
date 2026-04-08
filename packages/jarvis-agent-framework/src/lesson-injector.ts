import type { KnowledgeCollection, KnowledgeSearchResult } from "./knowledge.js";
import { AGENT_DEFAULT_COLLECTION } from "./lesson-capture.js";
import type { HybridRetriever } from "./hybrid-retriever.js";

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
 *
 * When a {@link HybridRetriever} is provided, lessons are retrieved via
 * semantic hybrid search (dense + sparse + RRF) instead of keyword matching,
 * yielding significantly more relevant context.
 */
export class LessonInjector {
  private retriever?: HybridRetriever;

  constructor(
    private readonly store: LessonSearchable,
    retriever?: HybridRetriever,
  ) {
    this.retriever = retriever;
  }

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
  ): string | Promise<string> {
    const collection = AGENT_DEFAULT_COLLECTION[agentId] ?? "lessons";

    // Build a search query from agent id + top goal keywords
    const goalKeywords = goal
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3)
      .slice(0, 5)
      .join(" ");
    const query = `${agentId} ${goalKeywords}`.trim();

    // Use hybrid retriever if available (semantic + keyword fusion)
    if (this.retriever) {
      return this.buildWithRetriever(query, collection, maxLessons);
    }

    // Fallback: keyword search
    return this.buildWithKeywordSearch(query, collection, maxLessons);
  }

  private buildWithKeywordSearch(
    query: string,
    collection: KnowledgeCollection,
    maxLessons: number,
  ): string {
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

  private async buildWithRetriever(
    query: string,
    collection: KnowledgeCollection,
    maxLessons: number,
  ): Promise<string> {
    try {
      const results = await this.retriever!.retrieve(
        query,
        maxLessons,
        collection,
      );

      if (results.length === 0) {
        // Fall back to keyword search if hybrid returns nothing
        return this.buildWithKeywordSearch(query, collection, maxLessons);
      }

      const lines = results.map((r) => {
        const summary =
          r.text.length > 200 ? r.text.slice(0, 200) + "..." : r.text;
        return `- ${summary}`;
      });

      return `LESSONS LEARNED (from previous runs, semantic match):\n${lines.join("\n")}`;
    } catch {
      // Fall back to keyword search if hybrid retrieval fails
      return this.buildWithKeywordSearch(query, collection, maxLessons);
    }
  }
}
