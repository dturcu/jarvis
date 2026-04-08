/**
 * governance.ts — Inference cost and reliability governance (Epic 6).
 *
 * Provides configurable limits on inference spending, latency,
 * local vs cloud routing, and fallback policies.
 */

// ---- Types ----------------------------------------------------------------

export type FallbackPolicy = 'reject' | 'queue' | 'degrade'

export interface InferenceGovernancePolicy {
  /** Maximum daily inference cost in USD. Undefined = no limit. */
  max_daily_cost_usd?: number
  /** Maximum per-request latency in ms. */
  max_request_latency_ms?: number
  /** Minimum fraction of requests that must use local models (0-1). */
  min_local_percentage?: number
  /** What to do when a limit is hit. */
  fallback_policy: FallbackPolicy
  /** Override cost per 1K tokens for specific models. */
  cost_per_token_override?: Record<string, number>
}

export interface InferenceUsageRecord {
  timestamp: string
  model: string
  runtime: string
  tokens_used: number
  latency_ms: number
  estimated_cost_usd: number
}

export interface GovernanceCheckResult {
  allowed: boolean
  reason?: string
  applied_policy?: string
}

// ---- Default policy -------------------------------------------------------

export const DEFAULT_GOVERNANCE_POLICY: InferenceGovernancePolicy = {
  fallback_policy: 'degrade',
}

// ---- Governance engine ----------------------------------------------------

export class InferenceGovernor {
  private readonly policy: InferenceGovernancePolicy
  private readonly usageLog: InferenceUsageRecord[] = []
  private dailyCostUsd = 0
  private dailyResetDate = ''
  private totalRequests = 0
  private localRequests = 0

  constructor(policy: InferenceGovernancePolicy = DEFAULT_GOVERNANCE_POLICY) {
    this.policy = policy
    this.dailyResetDate = new Date().toISOString().slice(0, 10)
  }

  /**
   * Check whether an inference request is allowed under current policy.
   */
  checkRequest(runtime: string, estimatedCostUsd: number): GovernanceCheckResult {
    this.maybeResetDaily()

    // Budget check
    if (
      this.policy.max_daily_cost_usd !== undefined &&
      this.dailyCostUsd + estimatedCostUsd > this.policy.max_daily_cost_usd
    ) {
      return {
        allowed: false,
        reason: `Daily cost limit exceeded (${this.dailyCostUsd.toFixed(4)} + ${estimatedCostUsd.toFixed(4)} > ${this.policy.max_daily_cost_usd})`,
        applied_policy: 'max_daily_cost_usd',
      }
    }

    // Local percentage check
    if (
      this.policy.min_local_percentage !== undefined &&
      this.totalRequests > 10 &&
      runtime !== 'ollama' && runtime !== 'lmstudio'
    ) {
      const currentLocalPct = this.totalRequests > 0 ? this.localRequests / this.totalRequests : 1
      if (currentLocalPct < this.policy.min_local_percentage) {
        return {
          allowed: false,
          reason: `Local percentage below minimum (${(currentLocalPct * 100).toFixed(1)}% < ${(this.policy.min_local_percentage * 100).toFixed(1)}%)`,
          applied_policy: 'min_local_percentage',
        }
      }
    }

    return { allowed: true }
  }

  /**
   * Record a completed inference request.
   */
  recordUsage(record: InferenceUsageRecord): void {
    this.maybeResetDaily()
    this.usageLog.push(record)
    this.dailyCostUsd += record.estimated_cost_usd
    this.totalRequests++
    if (record.runtime === 'ollama' || record.runtime === 'lmstudio') {
      this.localRequests++
    }
  }

  /**
   * Get current governance state for observability.
   */
  getState(): {
    daily_cost_usd: number
    total_requests: number
    local_percentage: number
    budget_remaining_usd: number | null
  } {
    this.maybeResetDaily()
    return {
      daily_cost_usd: this.dailyCostUsd,
      total_requests: this.totalRequests,
      local_percentage: this.totalRequests > 0 ? this.localRequests / this.totalRequests : 1,
      budget_remaining_usd: this.policy.max_daily_cost_usd !== undefined
        ? Math.max(0, this.policy.max_daily_cost_usd - this.dailyCostUsd)
        : null,
    }
  }

  /**
   * Estimate cost for a model/token count combination.
   */
  estimateCost(model: string, tokenCount: number): number {
    const costPer1k = this.policy.cost_per_token_override?.[model] ?? 0
    return (tokenCount / 1000) * costPer1k
  }

  private maybeResetDaily(): void {
    const today = new Date().toISOString().slice(0, 10)
    if (today !== this.dailyResetDate) {
      this.dailyCostUsd = 0
      this.totalRequests = 0
      this.localRequests = 0
      this.dailyResetDate = today
    }
  }
}
