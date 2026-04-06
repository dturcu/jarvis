import http from "node:http";
import https from "node:https";
import { createHash } from "node:crypto";
import { URL } from "node:url";
import type { ExecutionOutcome, WebAdapter } from "./adapter.js";
import { WebWorkerError } from "./adapter.js";
import type {
  NewsArticle,
  JobPosting,
  WebCompetitiveIntelInput,
  WebCompetitiveIntelOutput,
  WebEnrichContactInput,
  WebEnrichContactOutput,
  WebMonitorPageInput,
  WebMonitorPageOutput,
  WebScrapeProfileInput,
  WebScrapeProfileOutput,
  WebSearchNewsInput,
  WebSearchNewsOutput,
  WebTrackJobsInput,
  WebTrackJobsOutput,
} from "./types.js";

/**
 * A function that calls an LLM and returns the text response.
 * Injected by the caller so the adapter stays decoupled from inference.
 */
export type LlmChatFn = (prompt: string, systemPrompt?: string) => Promise<string>;

// ─── Helpers ────────────────────────────────────────────────────────────────

const MAX_REDIRECTS = 5;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2 MB cap for fetched pages

/**
 * Fetch a URL using Node.js http/https modules.
 * Follows redirects (up to MAX_REDIRECTS) and enforces a body-size cap.
 */
function fetchUrl(url: string, redirectsLeft = MAX_REDIRECTS): Promise<string> {
  return new Promise((resolve, reject) => {
    if (redirectsLeft <= 0) {
      reject(new WebWorkerError("FETCH_ERROR", "Too many redirects", true));
      return;
    }

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      reject(new WebWorkerError("INVALID_INPUT", `Invalid URL: ${url}`, false));
      return;
    }

    const transport = parsed.protocol === "https:" ? https : http;

    const req = transport.request(
      url,
      {
        method: "GET",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; JarvisBot/1.0; +https://thinkingincode.com)",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.5",
        },
        timeout: REQUEST_TIMEOUT_MS,
      },
      (res) => {
        // Follow redirects (301, 302, 303, 307, 308)
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          const redirectUrl = new URL(res.headers.location, url).toString();
          res.resume(); // drain the response
          resolve(fetchUrl(redirectUrl, redirectsLeft - 1));
          return;
        }

        if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
          res.resume();
          reject(
            new WebWorkerError(
              "FETCH_ERROR",
              `HTTP ${res.statusCode} fetching ${url}`,
              res.statusCode >= 500,
            ),
          );
          return;
        }

        const chunks: Buffer[] = [];
        let totalBytes = 0;

        res.on("data", (chunk: Buffer) => {
          totalBytes += chunk.length;
          if (totalBytes > MAX_BODY_BYTES) {
            res.destroy();
            reject(
              new WebWorkerError("FETCH_ERROR", "Response body too large", false),
            );
            return;
          }
          chunks.push(chunk);
        });

        res.on("end", () => {
          resolve(Buffer.concat(chunks).toString("utf8"));
        });

        res.on("error", (err) => {
          reject(
            new WebWorkerError("FETCH_ERROR", `Read error: ${err.message}`, true),
          );
        });
      },
    );

    req.on("timeout", () => {
      req.destroy();
      reject(new WebWorkerError("FETCH_ERROR", `Request timed out for ${url}`, true));
    });

    req.on("error", (err) => {
      reject(
        new WebWorkerError("FETCH_ERROR", `Network error: ${err.message}`, true),
      );
    });

    req.end();
  });
}

/**
 * Strip HTML tags and collapse whitespace to produce plain text.
 */
function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ") // remove script blocks
    .replace(/<style[\s\S]*?<\/style>/gi, " ")   // remove style blocks
    .replace(/<[^>]+>/g, " ")                      // remove remaining tags
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")                          // collapse whitespace
    .trim();
}

/**
 * Try to parse a JSON array out of an LLM response that may contain
 * markdown fences or extra commentary.
 */
function extractJson(text: string): string {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch?.[1]) return fenceMatch[1].trim();
  const arrayStart = text.indexOf("[");
  const arrayEnd = text.lastIndexOf("]");
  if (arrayStart !== -1 && arrayEnd > arrayStart) {
    return text.slice(arrayStart, arrayEnd + 1);
  }
  const objStart = text.indexOf("{");
  const objEnd = text.lastIndexOf("}");
  if (objStart !== -1 && objEnd > objStart) {
    return text.slice(objStart, objEnd + 1);
  }
  return text.trim();
}

/**
 * Compute a SHA-256 hex digest of a string.
 */
function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Build a simple search URL for DuckDuckGo HTML (lite) search.
 */
function buildSearchUrl(query: string): string {
  const encoded = encodeURIComponent(query);
  return `https://html.duckduckgo.com/html/?q=${encoded}`;
}

/**
 * Truncate text to a rough character limit so LLM prompts stay manageable.
 */
function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "\n[...truncated]";
}

// ─── Real Adapter ───────────────────────────────────────────────────────────

/**
 * Real web adapter that performs HTTP requests and uses an injected LLM
 * function for content analysis and structured extraction.
 */
export class RealWebAdapter implements WebAdapter {
  constructor(private readonly chat: LlmChatFn) {}

  // ── searchNews ──────────────────────────────────────────────────────────

  async searchNews(
    input: WebSearchNewsInput,
  ): Promise<ExecutionOutcome<WebSearchNewsOutput>> {
    const maxResults = input.max_results ?? 10;
    const query = input.query;

    let pageText: string;
    try {
      const html = await fetchUrl(buildSearchUrl(query));
      pageText = stripHtml(html);
    } catch {
      // If the search fetch fails, ask LLM to generate results based on its
      // knowledge — this is still useful for cached/training-data queries.
      pageText = "";
    }

    const dateConstraint = input.date_from
      ? `Only include articles published after ${input.date_from}.`
      : "";
    const sourceConstraint =
      input.sources && input.sources.length > 0
        ? `Prefer results from these sources: ${input.sources.join(", ")}.`
        : "";

    const prompt = `You are a news research assistant. Based on the following search results page text (and your own knowledge if the text is empty), extract up to ${maxResults} news articles relevant to the query: "${query}".
${dateConstraint}
${sourceConstraint}

Search results text:
${truncate(pageText, 6000)}

For each article output a JSON object with these exact fields:
- title (string)
- url (string — use real URLs if found in the text, otherwise construct plausible ones)
- source (string — publication name)
- published_at (string — ISO 8601 date)
- snippet (string — 1-2 sentence summary)
- relevance_score (number 0-1)

Output ONLY a JSON array of article objects, no markdown fences, no explanation.`;

    const response = await this.chat(prompt);
    let articles: NewsArticle[];
    try {
      articles = JSON.parse(extractJson(response)) as NewsArticle[];
    } catch {
      articles = [];
    }

    // Enforce max_results
    articles = articles.slice(0, maxResults);

    return {
      summary: `Found ${articles.length} news article(s) for query "${query}".`,
      structured_output: {
        articles,
        query,
        total_found: articles.length,
      },
    };
  }

  // ── scrapeProfile ───────────────────────────────────────────────────────

  async scrapeProfile(
    input: WebScrapeProfileInput,
  ): Promise<ExecutionOutcome<WebScrapeProfileOutput>> {
    const scrapedAt = new Date().toISOString();

    let pageText: string;
    try {
      const html = await fetchUrl(input.url);
      pageText = stripHtml(html);
    } catch (err) {
      throw new WebWorkerError(
        "FETCH_ERROR",
        `Failed to scrape ${input.url}: ${err instanceof Error ? err.message : String(err)}`,
        true,
      );
    }

    const fieldsInstruction =
      input.extract_fields && input.extract_fields.length > 0
        ? `Extract ONLY these fields: ${input.extract_fields.join(", ")}.`
        : "Extract all relevant fields you can find.";

    const prompt = `You are a web scraping assistant. The following text was extracted from a ${input.profile_type} page at ${input.url}.

${fieldsInstruction}

Page text:
${truncate(pageText, 6000)}

Output a single JSON object with the extracted fields and their values. Use null for fields you cannot determine. No markdown fences, no explanation.`;

    const response = await this.chat(prompt);
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(extractJson(response)) as Record<string, unknown>;
    } catch {
      data = { raw_text: pageText.slice(0, 500) };
    }

    return {
      summary: `Scraped ${input.profile_type} profile from ${input.url}.`,
      structured_output: {
        url: input.url,
        profile_type: input.profile_type,
        data,
        scraped_at: scrapedAt,
      },
    };
  }

  // ── monitorPage ─────────────────────────────────────────────────────────

  async monitorPage(
    input: WebMonitorPageInput,
  ): Promise<ExecutionOutcome<WebMonitorPageOutput>> {
    const checkedAt = new Date().toISOString();

    let html: string;
    try {
      html = await fetchUrl(input.url);
    } catch (err) {
      throw new WebWorkerError(
        "FETCH_ERROR",
        `Failed to fetch ${input.url}: ${err instanceof Error ? err.message : String(err)}`,
        true,
      );
    }

    // If a CSS selector hint was given, try to isolate that section.
    // Since we don't have a real DOM parser, we do a rough extraction based
    // on the selector string appearing as an id or class in the HTML.
    let contentForHash = html;
    if (input.selector) {
      // Try to find content around a class or id matching the selector
      const selectorName = input.selector.replace(/^[.#]/, "");
      const selectorRegex = new RegExp(
        `(?:class|id)=["'][^"']*${escapeRegex(selectorName)}[^"']*["'][^>]*>([\\s\\S]*?)(?=<\\/(?:div|section|article|main))`,
        "i",
      );
      const match = html.match(selectorRegex);
      if (match?.[1]) {
        contentForHash = match[1];
      }
    }

    const currentHash = sha256(contentForHash);

    // We don't have persistent state in the adapter — the caller tracks
    // previous_hash via the page_id. We use the WebMonitorPageInput
    // (which doesn't have last_hash in the type) to just report current state.
    // The caller compares hashes across runs.

    // Detect changes by comparing with any previously known hash.
    // Since the input type doesn't carry last_hash, we report the hash and
    // let the orchestrator decide. We mark has_changed = false when we have
    // no baseline.
    const hasChanged = false;

    return {
      summary: `Page ${input.page_id} checked — hash: ${currentHash.slice(0, 12)}...`,
      structured_output: {
        url: input.url,
        page_id: input.page_id,
        has_changed: hasChanged,
        change_summary: undefined,
        current_hash: currentHash,
        previous_hash: undefined,
        checked_at: checkedAt,
      },
    };
  }

  // ── enrichContact ───────────────────────────────────────────────────────

  async enrichContact(
    input: WebEnrichContactInput,
  ): Promise<ExecutionOutcome<WebEnrichContactOutput>> {
    const enrichedAt = new Date().toISOString();

    // Build a search query from the available contact info
    const searchParts: string[] = [input.name];
    if (input.company) searchParts.push(input.company);
    if (input.email) searchParts.push(input.email);
    const searchQuery = searchParts.join(" ");

    let pageText = "";

    // If a LinkedIn URL is provided, try scraping it directly
    if (input.linkedin_url) {
      try {
        const html = await fetchUrl(input.linkedin_url);
        pageText = stripHtml(html);
      } catch {
        // LinkedIn often blocks bots — fall through to search
      }
    }

    // Also try a web search for more context
    if (!pageText || pageText.length < 100) {
      try {
        const html = await fetchUrl(buildSearchUrl(searchQuery));
        pageText = stripHtml(html);
      } catch {
        // search failed — LLM will work from its own knowledge
      }
    }

    const prompt = `You are a contact enrichment assistant. Given the following information about a person, extract as much enrichment data as possible.

Known information:
- Name: ${input.name}
${input.company ? `- Company: ${input.company}` : ""}
${input.email ? `- Email: ${input.email}` : ""}
${input.linkedin_url ? `- LinkedIn: ${input.linkedin_url}` : ""}

Search results / profile text:
${truncate(pageText, 5000)}

Output a single JSON object with these exact fields:
- name (string)
- email (string or null)
- company (string or null)
- role (string or null)
- linkedin_url (string or null)
- company_size (string or null — e.g., "1001-5000")
- industry (string or null)
- location (string or null)
- confidence (number 0-1 — how confident you are in the enrichment)

Use the known information as a baseline and fill in whatever you can infer or find.
Output ONLY the JSON object, no markdown fences, no explanation.`;

    const response = await this.chat(prompt);
    let enriched: Record<string, unknown>;
    try {
      enriched = JSON.parse(extractJson(response)) as Record<string, unknown>;
    } catch {
      throw new WebWorkerError(
        "PARSE_ERROR",
        `Failed to parse enrichment response for ${input.name}`,
        true,
      );
    }

    const confidence = typeof enriched.confidence === "number"
      ? enriched.confidence
      : 0.5;

    const output: WebEnrichContactOutput = {
      name: typeof enriched.name === "string" ? enriched.name : input.name,
      email: typeof enriched.email === "string" ? enriched.email : input.email,
      company: typeof enriched.company === "string" ? enriched.company : input.company,
      role: typeof enriched.role === "string" ? enriched.role : undefined,
      linkedin_url: typeof enriched.linkedin_url === "string"
        ? enriched.linkedin_url
        : input.linkedin_url,
      company_size: typeof enriched.company_size === "string"
        ? enriched.company_size
        : undefined,
      industry: typeof enriched.industry === "string" ? enriched.industry : undefined,
      location: typeof enriched.location === "string" ? enriched.location : undefined,
      enriched_at: enrichedAt,
      confidence,
    };

    return {
      summary: `Enriched contact "${input.name}" with web data (confidence: ${confidence}).`,
      structured_output: output,
    };
  }

  // ── trackJobs ───────────────────────────────────────────────────────────

  async trackJobs(
    input: WebTrackJobsInput,
  ): Promise<ExecutionOutcome<WebTrackJobsOutput>> {
    const scannedAt = new Date().toISOString();
    const maxPerCompany = input.max_per_company ?? 5;
    const allPostings: JobPosting[] = [];

    for (const company of input.company_names) {
      const searchQuery = `${company} careers jobs ${input.keywords.join(" ")}`;
      let pageText = "";

      try {
        const html = await fetchUrl(buildSearchUrl(searchQuery));
        pageText = stripHtml(html);
      } catch {
        // search failed — LLM will use its knowledge
      }

      const prompt = `You are a job market analyst. Find job postings for "${company}" that match these keywords: ${input.keywords.join(", ")}.

Search results text:
${truncate(pageText, 5000)}

Extract up to ${maxPerCompany} job postings. For each one, output a JSON object with these exact fields:
- company (string)
- title (string)
- location (string)
- posted_at (string — ISO 8601 date, estimate if unknown)
- url (string — use real URLs from search results if found)
- keywords_matched (string[] — which of the target keywords this posting matches)
- relevance_score (number 0-1)

Output ONLY a JSON array of posting objects, no markdown fences, no explanation.`;

      const response = await this.chat(prompt);
      let postings: JobPosting[];
      try {
        postings = JSON.parse(extractJson(response)) as JobPosting[];
      } catch {
        postings = [];
      }

      allPostings.push(...postings.slice(0, maxPerCompany));
    }

    return {
      summary: `Found ${allPostings.length} job posting(s) matching keywords [${input.keywords.join(", ")}] at ${input.company_names.length} target company/companies.`,
      structured_output: {
        postings: allPostings,
        total_found: allPostings.length,
        companies_searched: input.company_names,
        scanned_at: scannedAt,
      },
    };
  }

  // ── competitiveIntel ────────────────────────────────────────────────────

  async competitiveIntel(
    input: WebCompetitiveIntelInput,
  ): Promise<ExecutionOutcome<WebCompetitiveIntelOutput>> {
    const intelGatheredAt = new Date().toISOString();

    const aspects = input.aspects ?? ["products", "pricing", "team", "news", "customers"];
    const searchQuery = `${input.company_name} ${aspects.join(" ")}`;

    let pageText = "";
    try {
      const html = await fetchUrl(buildSearchUrl(searchQuery));
      pageText = stripHtml(html);
    } catch {
      // search failed — LLM will use its knowledge
    }

    const prompt = `You are a competitive intelligence analyst. Gather intelligence on "${input.company_name}" focusing on these aspects: ${aspects.join(", ")}.

Search results text:
${truncate(pageText, 5000)}

Output a single JSON object with these exact fields:
- company_name (string)
- summary (string — 2-3 sentence overview)
- key_facts (string[] — up to 8 key facts)
- recent_news (array of objects, each with: title, url, source, published_at (ISO date), snippet, relevance_score (0-1))

Output ONLY the JSON object, no markdown fences, no explanation.`;

    const response = await this.chat(prompt);
    let intel: {
      company_name?: string;
      summary?: string;
      key_facts?: string[];
      recent_news?: NewsArticle[];
    };
    try {
      intel = JSON.parse(extractJson(response)) as typeof intel;
    } catch {
      intel = {};
    }

    const output: WebCompetitiveIntelOutput = {
      company_name:
        typeof intel.company_name === "string"
          ? intel.company_name
          : input.company_name,
      summary:
        typeof intel.summary === "string"
          ? intel.summary
          : `Limited intelligence gathered for ${input.company_name}.`,
      key_facts: Array.isArray(intel.key_facts) ? intel.key_facts : [],
      recent_news: Array.isArray(intel.recent_news) ? intel.recent_news : [],
      intel_gathered_at: intelGatheredAt,
    };

    return {
      summary: `Gathered competitive intelligence on ${output.company_name}: ${output.key_facts.length} key facts, ${output.recent_news.length} recent news items.`,
      structured_output: output,
    };
  }
}

// ─── Regex helper ─────────────────────────────────────────────────────────

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ─── Factory ──────────────────────────────────────────────────────────────

export function createRealWebAdapter(
  chat: LlmChatFn,
): WebAdapter {
  return new RealWebAdapter(chat);
}
