/**
 * wiki-bridge.ts — Bridge between Jarvis knowledge and OpenClaw memory-wiki (Epics 9-10).
 *
 * Publishes Jarvis knowledge documents to the wiki, queries wiki for
 * curated synthesized knowledge, and syncs changes.
 *
 * Sync rules:
 *   SYNC to wiki:     lessons, playbooks, case-studies, regulatory, garden
 *   DO NOT SYNC:      contracts, iso26262, aspice, cybersecurity, signed_records
 *   LINK ONLY:        wiki pages reference compliance artifacts by ID
 *
 * The wiki is a read-only compiled view. Jarvis authoritative stores remain
 * the source of truth for all domain data.
 */

import {
  invokeGatewayMethod,
  type GatewayCallOptions,
} from '@jarvis/shared'

// ---- Types ----------------------------------------------------------------

export interface KnowledgeDocument {
  doc_id: string
  title: string
  content: string
  tags: string[]
  collection: string
  source_agent_id?: string
  created_at: string
}

export interface WikiSearchResult {
  page_id: string
  title: string
  snippet: string
  relevance_score: number
  freshness: string
  source_collection?: string
}

export interface WikiHealthStatus {
  available: boolean
  page_count: number
  last_compile?: string
  last_sync?: string
}

export interface SyncResult {
  pages_created: number
  pages_updated: number
  pages_unchanged: number
  errors: string[]
}

export interface WikiSyncConfig {
  /** Whether wiki sync is enabled. */
  enabled: boolean
  /** Collections that should sync to wiki. */
  sync_collections: string[]
  /** Collections that must NEVER sync (compliance-grade). */
  blocked_collections: string[]
}

// ---- Default config -------------------------------------------------------

export const DEFAULT_WIKI_SYNC_CONFIG: WikiSyncConfig = {
  enabled: false,
  sync_collections: ['lessons', 'playbooks', 'case-studies', 'regulatory', 'garden'],
  blocked_collections: ['contracts', 'iso26262', 'aspice', 'cybersecurity', 'signed_records', 'safety_case', 'audit_trail'],
}

// ---- Wiki Bridge ----------------------------------------------------------

export interface WikiBridge {
  /** Publish a document to the wiki. Returns wiki page ID. */
  publish(doc: KnowledgeDocument): Promise<string>
  /** Search the wiki for curated knowledge. */
  query(query: string, limit?: number): Promise<WikiSearchResult[]>
  /** Sync Jarvis knowledge to wiki since a given timestamp. */
  sync(since: string): Promise<SyncResult>
  /** Check wiki health and availability. */
  status(): Promise<WikiHealthStatus>
}

/**
 * OpenClaw gateway-backed wiki bridge.
 *
 * Routes all wiki operations through the OpenClaw gateway's wiki.*
 * method family. If the gateway or wiki plugin is unavailable,
 * methods return sensible defaults (empty results, zero pages).
 */
export class GatewayWikiBridge implements WikiBridge {
  private readonly overrides: GatewayCallOptions
  private readonly syncConfig: WikiSyncConfig

  constructor(
    syncConfig: WikiSyncConfig = DEFAULT_WIKI_SYNC_CONFIG,
    overrides: GatewayCallOptions = {},
  ) {
    this.syncConfig = syncConfig
    this.overrides = overrides
  }

  async publish(doc: KnowledgeDocument): Promise<string> {
    // Enforce sync rules — never publish compliance collections
    if (this.syncConfig.blocked_collections.includes(doc.collection)) {
      throw new Error(
        `Collection "${doc.collection}" is compliance-grade and must NOT be published to wiki. ` +
        'Use Jarvis authoritative stores (knowledge.db, runtime.db) only.',
      )
    }

    if (!this.syncConfig.sync_collections.includes(doc.collection)) {
      throw new Error(
        `Collection "${doc.collection}" is not in the sync whitelist. ` +
        `Allowed: [${this.syncConfig.sync_collections.join(', ')}]`,
      )
    }

    const result = await invokeGatewayMethod<{ page_id?: string }>(
      'wiki.publish',
      undefined,
      {
        title: doc.title,
        content: doc.content,
        tags: doc.tags,
        collection: doc.collection,
        source_agent_id: doc.source_agent_id,
        source_doc_id: doc.doc_id,
      },
      this.overrides,
    )

    return result.page_id ?? doc.doc_id
  }

  async query(queryText: string, limit = 10): Promise<WikiSearchResult[]> {
    try {
      const result = await invokeGatewayMethod<{ results?: Array<Record<string, unknown>> }>(
        'wiki.search',
        undefined,
        { query: queryText, limit },
        this.overrides,
      )

      return (result.results ?? []).map((r) => ({
        page_id: String(r.page_id ?? ''),
        title: String(r.title ?? ''),
        snippet: String(r.snippet ?? r.content ?? ''),
        relevance_score: typeof r.relevance_score === 'number' ? r.relevance_score : 0,
        freshness: String(r.freshness ?? r.updated_at ?? ''),
        source_collection: r.source_collection ? String(r.source_collection) : undefined,
      }))
    } catch {
      return [] // Wiki unavailable
    }
  }

  async sync(since: string): Promise<SyncResult> {
    try {
      const result = await invokeGatewayMethod<Record<string, unknown>>(
        'wiki.sync',
        undefined,
        { since, collections: this.syncConfig.sync_collections },
        this.overrides,
      )

      return {
        pages_created: Number(result.pages_created ?? 0),
        pages_updated: Number(result.pages_updated ?? 0),
        pages_unchanged: Number(result.pages_unchanged ?? 0),
        errors: Array.isArray(result.errors) ? result.errors.map(String) : [],
      }
    } catch (err) {
      return {
        pages_created: 0,
        pages_updated: 0,
        pages_unchanged: 0,
        errors: [err instanceof Error ? err.message : String(err)],
      }
    }
  }

  async status(): Promise<WikiHealthStatus> {
    try {
      const result = await invokeGatewayMethod<Record<string, unknown>>(
        'wiki.status',
        undefined,
        {},
        this.overrides,
      )

      return {
        available: true,
        page_count: Number(result.page_count ?? 0),
        last_compile: result.last_compile ? String(result.last_compile) : undefined,
        last_sync: result.last_sync ? String(result.last_sync) : undefined,
      }
    } catch {
      return { available: false, page_count: 0 }
    }
  }

  /** Get the current sync configuration. */
  getSyncConfig(): WikiSyncConfig {
    return { ...this.syncConfig }
  }
}

// ---- Epic 10: Wiki retrieval source for HybridRetriever -------------------

/**
 * Retrieval source that queries the wiki for curated synthesized knowledge.
 *
 * Designed to plug into HybridRetriever as an additional ranking signal
 * alongside dense, sparse, RRF, and cross-encoder.
 */
export interface WikiRetrievalConfig {
  /** Weight for wiki results in hybrid retrieval (0-1, default 0.4). */
  weight: number
  /** Maximum results to fetch from wiki per query. */
  max_results: number
  /** Whether wiki retrieval is enabled. */
  enabled: boolean
}

export const DEFAULT_WIKI_RETRIEVAL_CONFIG: WikiRetrievalConfig = {
  weight: 0,      // Disabled by default — increase to 0.4 when wiki is populated
  max_results: 5,
  enabled: false,
}
