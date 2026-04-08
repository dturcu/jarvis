/**
 * memory-boundary.ts — Runtime memory taxonomy enforcement (Epic 7).
 *
 * Validates that writes go to the correct store according to the
 * ADR-MEMORY-TAXONOMY.md decision. Starts in "warn" mode (logs violations
 * but does not reject). Switch to "enforce" after 1 quarter clean.
 *
 * Hard rule: Compliance-grade evidence (contracts, audit trails, safety-case
 * artifacts, ISO 26262/ASPICE/cybersecurity evidence, signed records) remains
 * authoritatively in Jarvis runtime/CRM/knowledge DBs. OpenClaw memory/wiki
 * are for synthesized knowledge, heuristics, and operator notes only.
 */

// ---- Types ----------------------------------------------------------------

export type MemoryCategory =
  | 'conversation_context'   // Owner: OpenClaw — session state
  | 'run_state'              // Owner: Jarvis — runtime.db
  | 'domain_facts'           // Owner: Jarvis — crm.db, knowledge.db
  | 'operational_knowledge'  // Owner: Jarvis — knowledge.db
  | 'audit_trail'            // Owner: Jarvis — runtime.db audit_log
  | 'operator_preferences'   // Owner: OpenClaw — session / memory-wiki

export type TargetStore =
  | 'runtime_db'
  | 'crm_db'
  | 'knowledge_db'
  | 'session_state'
  | 'memory_wiki'

export type EnforcementMode = 'warn' | 'enforce'

export interface BoundaryValidation {
  valid: boolean
  violation?: string
  category: MemoryCategory
  target_store: TargetStore
}

// ---- Error class ----------------------------------------------------------

/**
 * Thrown when a memory boundary violation occurs in enforce mode.
 * Callers should catch this and treat it as a hard rejection.
 */
export class MemoryBoundaryError extends Error {
  constructor(message: string) {
    super(`[memory-boundary] BLOCKED: ${message}`)
    this.name = 'MemoryBoundaryError'
  }
}

// ---- Ownership matrix -----------------------------------------------------

const ALLOWED_STORES: Record<MemoryCategory, TargetStore[]> = {
  conversation_context:  ['session_state'],
  run_state:             ['runtime_db'],
  domain_facts:          ['crm_db', 'knowledge_db'],
  operational_knowledge: ['knowledge_db'],
  audit_trail:           ['runtime_db'],
  operator_preferences:  ['session_state', 'memory_wiki'],
}

/** Collections that contain compliance-grade evidence — never in wiki/memory. */
const COMPLIANCE_COLLECTIONS = new Set([
  'contracts',
  'iso26262',
  'aspice',
  'cybersecurity',
  'audit_trail',
  'signed_records',
  'safety_case',
])

// ---- Boundary Checker -----------------------------------------------------

export class MemoryBoundaryChecker {
  private readonly mode: EnforcementMode
  private readonly violations: BoundaryValidation[] = []

  constructor(mode: EnforcementMode = 'warn') {
    this.mode = mode
  }

  /**
   * Validate that a write to a given store is allowed for the given category.
   */
  validate(category: MemoryCategory, targetStore: TargetStore): BoundaryValidation {
    const allowed = ALLOWED_STORES[category]
    if (allowed.includes(targetStore)) {
      return { valid: true, category, target_store: targetStore }
    }

    const violation: BoundaryValidation = {
      valid: false,
      category,
      target_store: targetStore,
      violation: `Category "${category}" should write to [${allowed.join(', ')}], not "${targetStore}"`,
    }

    this.violations.push(violation)

    if (this.mode === 'enforce') {
      throw new MemoryBoundaryError(violation.violation!)
    }

    console.warn(`[memory-boundary] VIOLATION (warn mode): ${violation.violation}`)
    return violation
  }

  /**
   * Check whether a knowledge collection is compliance-grade and therefore
   * must NOT be written to OpenClaw memory/wiki.
   */
  isComplianceCollection(collection: string): boolean {
    return COMPLIANCE_COLLECTIONS.has(collection)
  }

  /**
   * Validate that a compliance collection is not being written to wiki/session.
   */
  validateComplianceBoundary(
    collection: string,
    targetStore: TargetStore,
  ): BoundaryValidation {
    if (!this.isComplianceCollection(collection)) {
      return { valid: true, category: 'operational_knowledge', target_store: targetStore }
    }

    if (targetStore === 'memory_wiki' || targetStore === 'session_state') {
      const violation: BoundaryValidation = {
        valid: false,
        category: 'audit_trail',
        target_store: targetStore,
        violation: `Compliance collection "${collection}" must NOT be written to ${targetStore}. Use knowledge_db or runtime_db.`,
      }
      this.violations.push(violation)

      if (this.mode === 'enforce') {
        throw new MemoryBoundaryError(violation.violation!)
      }

      console.warn(`[memory-boundary] COMPLIANCE VIOLATION: ${violation.violation}`)
      return violation
    }

    return { valid: true, category: 'operational_knowledge', target_store: targetStore }
  }

  /** Get all recorded violations. */
  getViolations(): BoundaryValidation[] {
    return [...this.violations]
  }

  /** Get the current enforcement mode. */
  getMode(): EnforcementMode {
    return this.mode
  }

  /** Clear recorded violations. */
  clearViolations(): void {
    this.violations.length = 0
  }

  /**
   * Graduate from "warn" to "enforce" mode.
   *
   * After a pilot period with zero compliance violations, call this to
   * make boundary violations hard errors instead of warnings. In enforce
   * mode, validate() and validateComplianceBoundary() throw on violation
   * instead of logging.
   */
  graduate(): MemoryBoundaryChecker {
    return new MemoryBoundaryChecker('enforce')
  }
}
