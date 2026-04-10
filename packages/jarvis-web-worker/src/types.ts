// ── web.search_news ───────────────────────────────────────────────────────────

export type WebSearchNewsInput = {
  query: string;           // e.g., "Meridian Engineering AUTOSAR safety"
  max_results?: number;    // default 10
  date_from?: string;      // ISO date
  sources?: string[];      // preferred sources
};

export type NewsArticle = {
  title: string;
  url: string;
  source: string;
  published_at: string;
  snippet: string;
  relevance_score: number; // 0-1
};

export type WebSearchNewsOutput = {
  articles: NewsArticle[];
  query: string;
  total_found: number;
};

// ── web.scrape_profile ────────────────────────────────────────────────────────

export type WebScrapeProfileInput = {
  url: string;
  profile_type: "company" | "person" | "job_posting";
  extract_fields?: string[];
};

export type WebScrapeProfileOutput = {
  url: string;
  profile_type: string;
  data: Record<string, unknown>; // extracted fields
  scraped_at: string;
};

// ── web.monitor_page ──────────────────────────────────────────────────────────

export type WebMonitorPageInput = {
  url: string;
  page_id: string;    // stable ID for tracking across runs
  selector?: string;  // CSS selector for specific section
};

export type WebMonitorPageOutput = {
  url: string;
  page_id: string;
  has_changed: boolean;
  change_summary?: string;
  current_hash: string;
  previous_hash?: string;
  checked_at: string;
};

// ── web.enrich_contact ────────────────────────────────────────────────────────

export type WebEnrichContactInput = {
  name: string;
  company?: string;
  email?: string;
  linkedin_url?: string;
};

export type WebEnrichContactOutput = {
  name: string;
  email?: string;
  company?: string;
  role?: string;
  linkedin_url?: string;
  company_size?: string;
  industry?: string;
  location?: string;
  enriched_at: string;
  confidence: number; // 0-1
};

// ── web.track_jobs ────────────────────────────────────────────────────────────

export type WebTrackJobsInput = {
  company_names: string[];
  keywords: string[];         // ["AUTOSAR", "ISO 26262", "safety"]
  max_per_company?: number;
};

export type JobPosting = {
  company: string;
  title: string;
  location: string;
  posted_at: string;
  url: string;
  keywords_matched: string[];
  relevance_score: number;
};

export type WebTrackJobsOutput = {
  postings: JobPosting[];
  total_found: number;
  companies_searched: string[];
  scanned_at: string;
};

// ── web.competitive_intel ─────────────────────────────────────────────────────

export type WebCompetitiveIntelInput = {
  company_name: string;
  aspects?: Array<"products" | "pricing" | "team" | "news" | "customers">;
};

export type WebCompetitiveIntelOutput = {
  company_name: string;
  summary: string;
  key_facts: string[];
  recent_news: NewsArticle[];
  intel_gathered_at: string;
};
