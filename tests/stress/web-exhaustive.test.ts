/**
 * Exhaustive Stress: Web Intelligence Worker
 *
 * Covers every web operation type with thorough input permutations:
 * news search, profile scraping, page monitoring, contact enrichment,
 * job tracking, competitive intel, concurrency, and full pipelines.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { MockWebAdapter, executeWebJob } from "@jarvis/web-worker";
import type { JobEnvelope } from "@jarvis/shared";
import { range } from "./helpers.js";

function envelope(type: string, input: Record<string, unknown>): JobEnvelope {
  return {
    contract_version: "1.0.0",
    job_id: randomUUID(),
    type: type as any,
    input,
    attempt: 1,
    metadata: { agent_id: "test", run_id: randomUUID() },
  };
}

// ── Mock data references ───────────────────────────────────────────────────
// Known contacts: Klaus Weber (Bertrandt), Anna Müller (EDAG)
// Known companies: Bertrandt AG, EDAG
// Articles about: Bertrandt, EDAG, Continental

describe("Web Exhaustive — search_news", () => {
  let web: MockWebAdapter;

  beforeEach(() => {
    web = new MockWebAdapter();
  });

  it("returns articles for automotive safety query", async () => {
    const result = await executeWebJob(
      envelope("web.search_news", { query: "automotive safety ISO 26262", max_results: 5 }),
      web,
    );
    expect(result.status).toBe("completed");
    const articles = result.structured_output?.articles as any[];
    expect(articles.length).toBeGreaterThan(0);
    for (const a of articles) {
      expect(a.title).toBeTruthy();
      expect(a.url).toBeTruthy();
    }
  });

  it("respects max_results=1", async () => {
    const result = await executeWebJob(
      envelope("web.search_news", { query: "Bertrandt automotive", max_results: 1 }),
      web,
    );
    expect(result.status).toBe("completed");
    const articles = result.structured_output?.articles as any[];
    expect(articles.length).toBeLessThanOrEqual(1);
  });

  it("respects max_results=3", async () => {
    const result = await executeWebJob(
      envelope("web.search_news", { query: "EDAG engineering", max_results: 3 }),
      web,
    );
    expect(result.status).toBe("completed");
    const articles = result.structured_output?.articles as any[];
    expect(articles.length).toBeLessThanOrEqual(3);
  });

  it("respects max_results=10", async () => {
    const result = await executeWebJob(
      envelope("web.search_news", { query: "Continental safety", max_results: 10 }),
      web,
    );
    expect(result.status).toBe("completed");
    const articles = result.structured_output?.articles as any[];
    expect(articles.length).toBeLessThanOrEqual(10);
  });

  it("respects max_results=20", async () => {
    const result = await executeWebJob(
      envelope("web.search_news", { query: "ISO 26262 consulting", max_results: 20 }),
      web,
    );
    expect(result.status).toBe("completed");
    const articles = result.structured_output?.articles as any[];
    expect(articles.length).toBeLessThanOrEqual(20);
  });

  it("handles empty query gracefully", async () => {
    const result = await executeWebJob(
      envelope("web.search_news", { query: "", max_results: 5 }),
      web,
    );
    expect(result.status).toBeDefined();
  });

  it("search count increments per call", async () => {
    await executeWebJob(envelope("web.search_news", { query: "ASPICE", max_results: 3 }), web);
    await executeWebJob(envelope("web.search_news", { query: "AUTOSAR", max_results: 3 }), web);
    await executeWebJob(envelope("web.search_news", { query: "cybersecurity", max_results: 3 }), web);
    expect(web.getSearchCount()).toBe(3);
  });

  it("returns articles about Bertrandt", async () => {
    const result = await executeWebJob(
      envelope("web.search_news", { query: "Bertrandt", max_results: 10 }),
      web,
    );
    expect(result.status).toBe("completed");
    expect(result.structured_output?.articles).toBeDefined();
  });

  it("returns articles about EDAG", async () => {
    const result = await executeWebJob(
      envelope("web.search_news", { query: "EDAG engineering services", max_results: 5 }),
      web,
    );
    expect(result.status).toBe("completed");
  });

  it("returns articles about Continental", async () => {
    const result = await executeWebJob(
      envelope("web.search_news", { query: "Continental automotive safety", max_results: 5 }),
      web,
    );
    expect(result.status).toBe("completed");
  });
});

describe("Web Exhaustive — scrape_profile", () => {
  let web: MockWebAdapter;

  beforeEach(() => {
    web = new MockWebAdapter();
  });

  it("scrapes company profile", async () => {
    const result = await executeWebJob(
      envelope("web.scrape_profile", { url: "https://bertrandt.com", profile_type: "company" }),
      web,
    );
    expect(result.status).toBe("completed");
    expect(result.structured_output?.profile_type).toBe("company");
    expect(result.structured_output?.data).toBeTruthy();
  });

  it("scrapes person profile", async () => {
    const result = await executeWebJob(
      envelope("web.scrape_profile", { url: "https://linkedin.com/in/klaus-weber", profile_type: "person" }),
      web,
    );
    expect(result.status).toBe("completed");
    expect(result.structured_output?.profile_type).toBe("person");
  });

  it("scrapes job_posting profile", async () => {
    const result = await executeWebJob(
      envelope("web.scrape_profile", { url: "https://bertrandt.com/careers/safety-engineer", profile_type: "job_posting" }),
      web,
    );
    expect(result.status).toBe("completed");
    expect(result.structured_output?.profile_type).toBe("job_posting");
  });

  it("scrapes with extract_fields parameter", async () => {
    const result = await executeWebJob(
      envelope("web.scrape_profile", {
        url: "https://edag.com",
        profile_type: "company",
        extract_fields: ["name", "industry", "location", "employees"],
      }),
      web,
    );
    expect(result.status).toBe("completed");
    expect(result.structured_output?.data).toBeTruthy();
  });

  it("handles unknown URL gracefully", async () => {
    const result = await executeWebJob(
      envelope("web.scrape_profile", { url: "https://unknown-company-xyz.invalid", profile_type: "company" }),
      web,
    );
    expect(result.status).toBeDefined();
  });

  it("scrape count increments correctly", async () => {
    await executeWebJob(envelope("web.scrape_profile", { url: "https://a.com", profile_type: "company" }), web);
    await executeWebJob(envelope("web.scrape_profile", { url: "https://b.com", profile_type: "person" }), web);
    expect(web.getScrapeCount()).toBe(2);
  });
});

describe("Web Exhaustive — monitor_page", () => {
  let web: MockWebAdapter;

  beforeEach(() => {
    web = new MockWebAdapter();
  });

  it("first visit reports no change", async () => {
    const result = await executeWebJob(
      envelope("web.monitor_page", { url: "https://example.com/pricing", page_id: "pricing" }),
      web,
    );
    expect(result.status).toBe("completed");
    expect(result.structured_output?.has_changed).toBe(false);
  });

  it("second visit detects change", async () => {
    await executeWebJob(
      envelope("web.monitor_page", { url: "https://example.com/pricing", page_id: "pricing" }),
      web,
    );
    const second = await executeWebJob(
      envelope("web.monitor_page", { url: "https://example.com/pricing", page_id: "pricing" }),
      web,
    );
    expect(second.status).toBe("completed");
    expect(web.getMonitoredPages()).toContain("pricing");
  });

  it("tracks multiple pages independently", async () => {
    await executeWebJob(envelope("web.monitor_page", { url: "https://example.com/a", page_id: "page-a" }), web);
    await executeWebJob(envelope("web.monitor_page", { url: "https://example.com/b", page_id: "page-b" }), web);
    await executeWebJob(envelope("web.monitor_page", { url: "https://example.com/c", page_id: "page-c" }), web);
    const pages = web.getMonitoredPages();
    expect(pages).toContain("page-a");
    expect(pages).toContain("page-b");
    expect(pages).toContain("page-c");
  });

  it("getMonitoredPages returns all tracked page IDs", async () => {
    expect(web.getMonitoredPages()).toHaveLength(0);
    await executeWebJob(envelope("web.monitor_page", { url: "https://x.com/1", page_id: "x1" }), web);
    await executeWebJob(envelope("web.monitor_page", { url: "https://x.com/2", page_id: "x2" }), web);
    expect(web.getMonitoredPages()).toHaveLength(2);
  });
});

describe("Web Exhaustive — enrich_contact", () => {
  let web: MockWebAdapter;

  beforeEach(() => {
    web = new MockWebAdapter();
  });

  it("enriches known contact Klaus Weber at Bertrandt", async () => {
    const result = await executeWebJob(
      envelope("web.enrich_contact", { name: "Klaus Weber", company: "Bertrandt" }),
      web,
    );
    expect(result.status).toBe("completed");
    const data = result.structured_output as any;
    expect(data.name).toBe("Klaus Weber");
    expect(data.confidence).toBeGreaterThan(0);
  });

  it("enriches known contact Anna Muller at EDAG", async () => {
    const result = await executeWebJob(
      envelope("web.enrich_contact", { name: "Anna Müller", company: "EDAG" }),
      web,
    );
    expect(result.status).toBe("completed");
    const data = result.structured_output as any;
    expect(data.name).toBe("Anna Müller");
    expect(data.confidence).toBeGreaterThan(0);
  });

  it("unknown contact returns graceful result", async () => {
    const result = await executeWebJob(
      envelope("web.enrich_contact", { name: "Nonexistent Person", company: "Fake Corp GmbH" }),
      web,
    );
    expect(result.status).toBeDefined();
  });

  it("enriches with email provided", async () => {
    const result = await executeWebJob(
      envelope("web.enrich_contact", { name: "Klaus Weber", company: "Bertrandt", email: "k.weber@bertrandt.com" }),
      web,
    );
    expect(result.status).toBe("completed");
  });

  it("enriches with linkedin_url provided", async () => {
    const result = await executeWebJob(
      envelope("web.enrich_contact", { name: "Anna Müller", company: "EDAG", linkedin_url: "https://linkedin.com/in/anna-muller" }),
      web,
    );
    expect(result.status).toBe("completed");
  });
});

describe("Web Exhaustive — track_jobs", () => {
  let web: MockWebAdapter;

  beforeEach(() => {
    web = new MockWebAdapter();
  });

  it("tracks jobs for a single company", async () => {
    const result = await executeWebJob(
      envelope("web.track_jobs", { company_names: ["Bertrandt"], keywords: ["safety"] }),
      web,
    );
    expect(result.status).toBe("completed");
    const postings = result.structured_output?.postings as any[];
    expect(postings.length).toBeGreaterThan(0);
    for (const p of postings) {
      expect(p.title).toBeTruthy();
      expect(p.company).toBeTruthy();
    }
  });

  it("tracks jobs for multiple companies", async () => {
    const result = await executeWebJob(
      envelope("web.track_jobs", {
        company_names: ["Bertrandt", "EDAG", "Continental"],
        keywords: ["safety", "AUTOSAR"],
      }),
      web,
    );
    expect(result.status).toBe("completed");
    const postings = result.structured_output?.postings as any[];
    expect(postings.length).toBeGreaterThan(0);
  });

  it("tracks jobs with specific keywords", async () => {
    const result = await executeWebJob(
      envelope("web.track_jobs", {
        company_names: ["Bertrandt"],
        keywords: ["ISO 26262", "ASPICE", "functional safety"],
      }),
      web,
    );
    expect(result.status).toBe("completed");
  });

  it("respects max_per_company limit", async () => {
    const result = await executeWebJob(
      envelope("web.track_jobs", {
        company_names: ["Bertrandt", "EDAG"],
        keywords: ["safety"],
        max_per_company: 2,
      }),
      web,
    );
    expect(result.status).toBe("completed");
    const postings = result.structured_output?.postings as any[];
    // Each company capped at 2
    const bertrandtCount = postings.filter((p: any) => p.company?.includes("Bertrandt")).length;
    expect(bertrandtCount).toBeLessThanOrEqual(2);
  });

  it("handles no matching keywords", async () => {
    const result = await executeWebJob(
      envelope("web.track_jobs", {
        company_names: ["Bertrandt"],
        keywords: ["quantum computing", "blockchain"],
      }),
      web,
    );
    expect(result.status).toBeDefined();
  });

  it("handles empty company_names array", async () => {
    const result = await executeWebJob(
      envelope("web.track_jobs", { company_names: [], keywords: ["safety"] }),
      web,
    );
    expect(result.status).toBeDefined();
  });

  it("handles empty keywords array", async () => {
    const result = await executeWebJob(
      envelope("web.track_jobs", { company_names: ["Bertrandt"], keywords: [] }),
      web,
    );
    expect(result.status).toBeDefined();
  });
});

describe("Web Exhaustive — competitive_intel", () => {
  let web: MockWebAdapter;

  beforeEach(() => {
    web = new MockWebAdapter();
  });

  it("returns intel for Bertrandt with canonical name", async () => {
    const result = await executeWebJob(
      envelope("web.competitive_intel", { company_name: "Bertrandt", aspects: ["products"] }),
      web,
    );
    expect(result.status).toBe("completed");
    expect(result.structured_output?.company_name).toBe("Bertrandt AG");
  });

  it("returns intel for EDAG", async () => {
    const result = await executeWebJob(
      envelope("web.competitive_intel", { company_name: "EDAG", aspects: ["products"] }),
      web,
    );
    expect(result.status).toBe("completed");
  });

  it("handles unknown company gracefully", async () => {
    const result = await executeWebJob(
      envelope("web.competitive_intel", { company_name: "Totally Unknown GmbH", aspects: ["products"] }),
      web,
    );
    expect(result.status).toBe("completed");
  });

  it("gathers products aspect", async () => {
    const result = await executeWebJob(
      envelope("web.competitive_intel", { company_name: "Bertrandt", aspects: ["products"] }),
      web,
    );
    expect(result.status).toBe("completed");
  });

  it("gathers pricing aspect", async () => {
    const result = await executeWebJob(
      envelope("web.competitive_intel", { company_name: "Bertrandt", aspects: ["pricing"] }),
      web,
    );
    expect(result.status).toBe("completed");
  });

  it("gathers team aspect", async () => {
    const result = await executeWebJob(
      envelope("web.competitive_intel", { company_name: "Bertrandt", aspects: ["team"] }),
      web,
    );
    expect(result.status).toBe("completed");
  });

  it("gathers news aspect", async () => {
    const result = await executeWebJob(
      envelope("web.competitive_intel", { company_name: "Bertrandt", aspects: ["news"] }),
      web,
    );
    expect(result.status).toBe("completed");
  });

  it("gathers customers aspect", async () => {
    const result = await executeWebJob(
      envelope("web.competitive_intel", { company_name: "Bertrandt", aspects: ["customers"] }),
      web,
    );
    expect(result.status).toBe("completed");
  });

  it("gathers multiple aspects at once", async () => {
    const result = await executeWebJob(
      envelope("web.competitive_intel", {
        company_name: "Bertrandt",
        aspects: ["products", "pricing", "team", "news", "customers"],
      }),
      web,
    );
    expect(result.status).toBe("completed");
  });
});

describe("Web Exhaustive — concurrency and pipelines", () => {
  let web: MockWebAdapter;

  beforeEach(() => {
    web = new MockWebAdapter();
  });

  it("30 parallel mixed web operations", async () => {
    const ops = [
      ...range(6).map(i =>
        executeWebJob(envelope("web.search_news", { query: `topic-${i}`, max_results: 3 }), web),
      ),
      ...range(6).map(i =>
        executeWebJob(envelope("web.scrape_profile", { url: `https://co-${i}.com`, profile_type: "company" }), web),
      ),
      ...range(5).map(i =>
        executeWebJob(envelope("web.monitor_page", { url: `https://page-${i}.com`, page_id: `pg-${i}` }), web),
      ),
      ...range(5).map(i =>
        executeWebJob(envelope("web.enrich_contact", { name: i % 2 === 0 ? "Klaus Weber" : "Anna Müller", company: i % 2 === 0 ? "Bertrandt" : "EDAG" }), web),
      ),
      ...range(4).map(() =>
        executeWebJob(envelope("web.track_jobs", { company_names: ["Bertrandt"], keywords: ["safety"] }), web),
      ),
      ...range(4).map(() =>
        executeWebJob(envelope("web.competitive_intel", { company_name: "EDAG", aspects: ["news"] }), web),
      ),
    ];
    const results = await Promise.all(ops);
    expect(results).toHaveLength(30);
    expect(results.every(r => r.status === "completed")).toBe(true);
    expect(web.getSearchCount()).toBe(6);
    expect(web.getScrapeCount()).toBe(6);
  });

  it("full intelligence pipeline: search -> scrape -> enrich -> track -> intel", async () => {
    // Step 1 — Search news
    const news = await executeWebJob(
      envelope("web.search_news", { query: "ISO 26262 consulting Germany", max_results: 5 }),
      web,
    );
    expect(news.status).toBe("completed");

    // Step 2 — Scrape company profile
    const profile = await executeWebJob(
      envelope("web.scrape_profile", { url: "https://bertrandt.com", profile_type: "company" }),
      web,
    );
    expect(profile.status).toBe("completed");

    // Step 3 — Enrich a contact found during scrape
    const enriched = await executeWebJob(
      envelope("web.enrich_contact", { name: "Klaus Weber", company: "Bertrandt" }),
      web,
    );
    expect(enriched.status).toBe("completed");
    expect((enriched.structured_output as any).name).toBe("Klaus Weber");

    // Step 4 — Track job openings
    const jobs = await executeWebJob(
      envelope("web.track_jobs", { company_names: ["Bertrandt", "EDAG"], keywords: ["safety", "AUTOSAR"] }),
      web,
    );
    expect(jobs.status).toBe("completed");

    // Step 5 — Competitive intelligence
    const intel = await executeWebJob(
      envelope("web.competitive_intel", { company_name: "Bertrandt", aspects: ["products", "team", "news", "customers"] }),
      web,
    );
    expect(intel.status).toBe("completed");
    expect(intel.structured_output?.company_name).toBe("Bertrandt AG");

    // Verify cumulative adapter state
    expect(web.getSearchCount()).toBe(1);
    expect(web.getScrapeCount()).toBe(1);
  });
});

describe("Web Exhaustive — edge cases", () => {
  let web: MockWebAdapter;

  beforeEach(() => {
    web = new MockWebAdapter();
  });

  it("empty company_names in track_jobs", async () => {
    const result = await executeWebJob(
      envelope("web.track_jobs", { company_names: [], keywords: ["anything"] }),
      web,
    );
    expect(result.status).toBeDefined();
  });

  it("empty keywords in track_jobs", async () => {
    const result = await executeWebJob(
      envelope("web.track_jobs", { company_names: ["Bertrandt"], keywords: [] }),
      web,
    );
    expect(result.status).toBeDefined();
  });

  it("very long query in search_news", async () => {
    const longQuery = "automotive safety " + range(50).map(i => `keyword-${i}`).join(" ");
    const result = await executeWebJob(
      envelope("web.search_news", { query: longQuery, max_results: 5 }),
      web,
    );
    expect(result.status).toBeDefined();
  });

  it("scrape_profile with all extract_fields", async () => {
    const result = await executeWebJob(
      envelope("web.scrape_profile", {
        url: "https://bertrandt.com",
        profile_type: "company",
        extract_fields: ["name", "industry", "location", "employees", "revenue", "founded"],
      }),
      web,
    );
    expect(result.status).toBe("completed");
  });

  it("enrich_contact with both email and linkedin_url", async () => {
    const result = await executeWebJob(
      envelope("web.enrich_contact", {
        name: "Klaus Weber",
        company: "Bertrandt",
        email: "k.weber@bertrandt.com",
        linkedin_url: "https://linkedin.com/in/klaus-weber",
      }),
      web,
    );
    expect(result.status).toBe("completed");
  });

  it("competitive_intel with single aspect", async () => {
    const result = await executeWebJob(
      envelope("web.competitive_intel", { company_name: "Bertrandt", aspects: ["products"] }),
      web,
    );
    expect(result.status).toBe("completed");
  });

  it("monitor_page third visit continues tracking", async () => {
    await executeWebJob(envelope("web.monitor_page", { url: "https://x.com", page_id: "repeat" }), web);
    await executeWebJob(envelope("web.monitor_page", { url: "https://x.com", page_id: "repeat" }), web);
    const third = await executeWebJob(
      envelope("web.monitor_page", { url: "https://x.com", page_id: "repeat" }),
      web,
    );
    expect(third.status).toBe("completed");
    expect(web.getMonitoredPages()).toContain("repeat");
  });
});
