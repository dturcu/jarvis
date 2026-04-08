/**
 * dreaming.ts — Controlled background knowledge consolidation (Epic 8).
 *
 * Runs as a low-priority daemon task during off-hours. Queries recent
 * lessons, entity graph entries, and knowledge documents, then consolidates
 * via deduplication, cross-referencing, and frequency ranking.
 *
 * Prerequisite: at least 3 agents must be runtime-registered and producing
 * memory/knowledge writes. If ALL_AGENTS is empty, dreaming is a no-op.
 *
 * Design: Jarvis-native implementation. If OpenClaw provides a dreaming API
 * in the future, this module can delegate to it.
 */

// ---- Types ----------------------------------------------------------------

export type SynthesisMode =
  | 'lesson_consolidation'  // merge similar lessons, deduplicate, rank by frequency
  | 'entity_dedup'          // merge duplicate entities in entity graph
  | 'cross_reference'       // link knowledge docs to related entities and runs

export interface DreamingConfig {
  /** Agent IDs enabled for dreaming. Empty = dreaming disabled. */
  enabled_agents: string[]
  /** Cron expression for dreaming schedule (default: 3 AM daily). */
  schedule_cron: string
  /** Maximum duration for a single dreaming run in ms. */
  max_duration_ms: number
  /** Which synthesis modes to run. */
  synthesis_modes: SynthesisMode[]
  /** Whether to require approval before modifying knowledge store. */
  require_approval: boolean
}

export interface DreamingRun {
  run_id: string
  started_at: string
  completed_at?: string
  agents_processed: string[]
  synthesis_results: SynthesisResult[]
  status: 'running' | 'completed' | 'failed'
  error?: string
}

export interface SynthesisResult {
  mode: SynthesisMode
  agent_id: string
  items_scanned: number
  items_consolidated: number
  items_promoted: number
  details: string
}

// ---- Default config -------------------------------------------------------

export const DEFAULT_DREAMING_CONFIG: DreamingConfig = {
  enabled_agents: [],
  schedule_cron: '0 3 * * *',
  max_duration_ms: 10 * 60 * 1000, // 10 minutes
  synthesis_modes: ['lesson_consolidation', 'entity_dedup', 'cross_reference'],
  require_approval: true,
}

/**
 * Pilot dreaming configuration for the 3 best-candidate agents
 * (per CLAUDE.md and Platform Adoption Roadmap Epic 8).
 *
 * These agents produce the most knowledge store writes and benefit
 * from cross-run consolidation:
 *   - proposal-engine: repeated client/offer patterns
 *   - regulatory-watch: evolving standards and regulatory landscape
 *   - knowledge-curator: high-volume document/meeting ingestion
 *
 * Usage: `new DreamingOrchestrator(PILOT_DREAMING_CONFIG)`
 */
export const PILOT_DREAMING_CONFIG: DreamingConfig = {
  enabled_agents: ['proposal-engine', 'regulatory-watch', 'knowledge-curator'],
  schedule_cron: '0 3 * * *',   // 3 AM daily
  max_duration_ms: 10 * 60 * 1000,
  synthesis_modes: ['lesson_consolidation', 'entity_dedup', 'cross_reference'],
  require_approval: true,
}

// ---- Dreaming orchestrator ------------------------------------------------

export class DreamingOrchestrator {
  private readonly config: DreamingConfig
  private currentRun: DreamingRun | null = null

  constructor(config: DreamingConfig = DEFAULT_DREAMING_CONFIG) {
    this.config = config
  }

  /** Whether dreaming is enabled (at least one agent configured). */
  isEnabled(): boolean {
    return this.config.enabled_agents.length > 0
  }

  /** Get the current dreaming configuration. */
  getConfig(): DreamingConfig {
    return { ...this.config }
  }

  /**
   * Execute a dreaming run.
   *
   * Scans lessons and knowledge for the configured agents, then runs
   * each enabled synthesis mode. Returns the run summary.
   *
   * @param queryLessons  Function to query lessons for an agent
   * @param queryEntities Function to query entity graph for an agent
   * @param queryKnowledge Function to query knowledge docs for an agent
   */
  async execute(deps: {
    queryLessons: (agentId: string) => Array<{ content: string; tags: string[]; created_at: string }>
    queryEntities: (agentId: string) => Array<{ entity_id: string; name: string; type: string }>
    queryKnowledge: (agentId: string) => Array<{ doc_id: string; title: string; content: string; tags: string[] }>
  }): Promise<DreamingRun> {
    if (!this.isEnabled()) {
      return {
        run_id: crypto.randomUUID(),
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        agents_processed: [],
        synthesis_results: [],
        status: 'completed',
      }
    }

    const run: DreamingRun = {
      run_id: crypto.randomUUID(),
      started_at: new Date().toISOString(),
      agents_processed: [],
      synthesis_results: [],
      status: 'running',
    }
    this.currentRun = run

    const deadline = Date.now() + this.config.max_duration_ms

    try {
      for (const agentId of this.config.enabled_agents) {
        if (Date.now() > deadline) break

        run.agents_processed.push(agentId)

        for (const mode of this.config.synthesis_modes) {
          if (Date.now() > deadline) break

          const result = await this.runSynthesis(mode, agentId, deps)
          run.synthesis_results.push(result)
        }
      }

      run.status = 'completed'
      run.completed_at = new Date().toISOString()
    } catch (err) {
      run.status = 'failed'
      run.error = err instanceof Error ? err.message : String(err)
      run.completed_at = new Date().toISOString()
    }

    this.currentRun = null
    return run
  }

  /** Get the current run if dreaming is active. */
  getCurrentRun(): DreamingRun | null {
    return this.currentRun
  }

  // ---- Synthesis modes ----------------------------------------------------

  private async runSynthesis(
    mode: SynthesisMode,
    agentId: string,
    deps: {
      queryLessons: (agentId: string) => Array<{ content: string; tags: string[]; created_at: string }>
      queryEntities: (agentId: string) => Array<{ entity_id: string; name: string; type: string }>
      queryKnowledge: (agentId: string) => Array<{ doc_id: string; title: string; content: string; tags: string[] }>
    },
  ): Promise<SynthesisResult> {
    switch (mode) {
      case 'lesson_consolidation':
        return this.consolidateLessons(agentId, deps.queryLessons)
      case 'entity_dedup':
        return this.deduplicateEntities(agentId, deps.queryEntities)
      case 'cross_reference':
        return this.crossReference(agentId, deps.queryKnowledge)
    }
  }

  private async consolidateLessons(
    agentId: string,
    query: (agentId: string) => Array<{ content: string; tags: string[]; created_at: string }>,
  ): Promise<SynthesisResult> {
    const lessons = query(agentId)

    // Group by tag similarity, find duplicates
    const tagGroups = new Map<string, number>()
    for (const lesson of lessons) {
      const key = lesson.tags.sort().join(',')
      tagGroups.set(key, (tagGroups.get(key) ?? 0) + 1)
    }

    const duplicateGroups = [...tagGroups.entries()].filter(([, count]) => count > 1)

    return {
      mode: 'lesson_consolidation',
      agent_id: agentId,
      items_scanned: lessons.length,
      items_consolidated: duplicateGroups.length,
      items_promoted: 0, // Promotions require approval gate
      details: `Scanned ${lessons.length} lessons, found ${duplicateGroups.length} consolidation candidates`,
    }
  }

  private async deduplicateEntities(
    agentId: string,
    query: (agentId: string) => Array<{ entity_id: string; name: string; type: string }>,
  ): Promise<SynthesisResult> {
    const entities = query(agentId)

    // Find entities with similar names (case-insensitive)
    const nameMap = new Map<string, string[]>()
    for (const entity of entities) {
      const normalized = entity.name.toLowerCase().trim()
      const existing = nameMap.get(normalized) ?? []
      existing.push(entity.entity_id)
      nameMap.set(normalized, existing)
    }

    const duplicates = [...nameMap.values()].filter((ids) => ids.length > 1)

    return {
      mode: 'entity_dedup',
      agent_id: agentId,
      items_scanned: entities.length,
      items_consolidated: duplicates.length,
      items_promoted: 0,
      details: `Scanned ${entities.length} entities, found ${duplicates.length} potential duplicates`,
    }
  }

  private async crossReference(
    agentId: string,
    query: (agentId: string) => Array<{ doc_id: string; title: string; content: string; tags: string[] }>,
  ): Promise<SynthesisResult> {
    const docs = query(agentId)

    // Find documents with overlapping tags
    const tagIndex = new Map<string, string[]>()
    for (const doc of docs) {
      for (const tag of doc.tags) {
        const existing = tagIndex.get(tag) ?? []
        existing.push(doc.doc_id)
        tagIndex.set(tag, existing)
      }
    }

    const crossRefs = [...tagIndex.values()].filter((ids) => ids.length > 1)

    return {
      mode: 'cross_reference',
      agent_id: agentId,
      items_scanned: docs.length,
      items_consolidated: 0,
      items_promoted: crossRefs.length,
      details: `Scanned ${docs.length} documents, found ${crossRefs.length} cross-reference opportunities`,
    }
  }
}
