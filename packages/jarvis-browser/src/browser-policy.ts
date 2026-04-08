/**
 * browser-policy.ts — Browser profile and sandbox policy types (Epic 11).
 *
 * Defines the policy framework for managed browser profiles, domain
 * allowlists, and sandbox enforcement.
 *
 * Platform note: The system runs on Windows 11. OS-level sandboxing
 * options include Windows Sandbox and Hyper-V isolation.
 */

// ---- Types ----------------------------------------------------------------

export interface BrowserPolicy {
  /** Human-readable profile name. */
  name: string
  /** Allowed domains (empty = all allowed). */
  allowed_domains: string[]
  /** Blocked domains (takes precedence over allowed). */
  blocked_domains: string[]
  /** Whether JavaScript execution is allowed. */
  allow_javascript: boolean
  /** Whether file downloads are allowed. */
  allow_downloads: boolean
  /** Cookie policy. */
  cookie_policy: 'accept_all' | 'first_party_only' | 'reject_all'
  /** Maximum page load timeout in ms. */
  page_timeout_ms: number
}

export interface ProfileInfo {
  name: string
  policy: BrowserPolicy
  created_at: string
  active: boolean
}

export interface BrowserSandboxConfig {
  /** Whether OS-level sandboxing is enabled. */
  enabled: boolean
  /** Sandbox method (platform-dependent). */
  method: 'none' | 'child_process' | 'windows_sandbox' | 'container'
  /** Filesystem paths the browser process can access. */
  filesystem_allowlist: string[]
  /** Network restrictions. */
  network_restrictions: {
    allow_localhost: boolean
    allow_internet: boolean
    blocked_ports: number[]
  }
}

/**
 * Browser capability matrix — documents which job types are supported
 * per bridge mode. Used by convergence checks and runtime routing.
 */
export interface BrowserCapabilityMatrix {
  job_type: string
  openclaw_bridge: 'yes' | 'partial' | 'no'
  legacy_puppeteer: 'yes' | 'no'
  notes?: string
}

// ---- Defaults --------------------------------------------------------------

export const DEFAULT_BROWSER_POLICY: BrowserPolicy = {
  name: 'default',
  allowed_domains: [],
  blocked_domains: [],
  allow_javascript: true,
  allow_downloads: true,
  cookie_policy: 'first_party_only',
  page_timeout_ms: 30_000,
}

export const DEFAULT_SANDBOX_CONFIG: BrowserSandboxConfig = {
  enabled: false,
  method: 'child_process',
  filesystem_allowlist: [],
  network_restrictions: {
    allow_localhost: true,
    allow_internet: true,
    blocked_ports: [],
  },
}

/** Current capability matrix (as of convergence Wave 8). */
export const BROWSER_CAPABILITY_MATRIX: BrowserCapabilityMatrix[] = [
  { job_type: 'browser.navigate',  openclaw_bridge: 'yes',     legacy_puppeteer: 'yes' },
  { job_type: 'browser.extract',   openclaw_bridge: 'yes',     legacy_puppeteer: 'yes' },
  { job_type: 'browser.capture',   openclaw_bridge: 'yes',     legacy_puppeteer: 'yes' },
  { job_type: 'browser.download',  openclaw_bridge: 'yes',     legacy_puppeteer: 'yes' },
  { job_type: 'browser.run_task',  openclaw_bridge: 'yes',     legacy_puppeteer: 'yes' },
  { job_type: 'browser.click',     openclaw_bridge: 'partial', legacy_puppeteer: 'yes', notes: 'Exit 4 gap — requires OpenClaw bridge support' },
  { job_type: 'browser.type',      openclaw_bridge: 'partial', legacy_puppeteer: 'yes', notes: 'Exit 4 gap — requires OpenClaw bridge support' },
  { job_type: 'browser.evaluate',  openclaw_bridge: 'partial', legacy_puppeteer: 'yes', notes: 'Exit 4 gap — requires OpenClaw bridge support' },
  { job_type: 'browser.wait_for',  openclaw_bridge: 'partial', legacy_puppeteer: 'yes', notes: 'Exit 4 gap — requires OpenClaw bridge support' },
]
