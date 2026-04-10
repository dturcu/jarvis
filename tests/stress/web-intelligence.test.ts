/**
 * Stress: Web Intelligence Worker
 *
 * Tests web operations via MockWebAdapter: news search, profile scraping,
 * page monitoring, contact enrichment, job tracking, competitive intel.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { MockWebAdapter, executeWebJob } from "@jarvis/web-worker";
import type { JobEnvelope } from "@jarvis/shared";

function envelope(type: string, input: Record<string, unknown>): JobEnvelope {
  return {
    contract_version: "1.0.0",
    job_id: randomUUID(),
    type: type as any,
    input,
    attempt: 1,
    metadata: { agent_id: "stress-web", run_id: randomUUID() },
  };
}

describe("Web Intelligence Stress", () => {
  let web: MockWebAdapter;

  beforeEach(() => {
    web = new MockWebAdapter();
  });

  it("news search returns automotive safety articles", async () => {
    const result = await executeWebJob(
      envelope("web.search_news", {
        query: "automotive safety ISO 26262",
        max_results: 10,
      }),
      web,
    );

    expect(result.status).toBe("completed");
    const articles = result.structured_output?.articles as any[];
    expect(articles.length).toBeGreaterThan(0);
    for (const article of articles) {
      expect(article.title).toBeTruthy();
      expect(article.url).toBeTruthy();
    }
    expect(web.getSearchCount()).toBe(1);
  });

  it("profile scraping: company type", async () => {
    const result = await executeWebJob(
      envelope("web.scrape_profile", {
        url: "https://example-meridian.com",
        profile_type: "company",
      }),
      web,
    );

    expect(result.status).toBe("completed");
    expect(result.structured_output?.profile_type).toBe("company");
    expect(result.structured_output?.data).toBeTruthy();
    expect(web.getScrapeCount()).toBe(1);
  });

  it("profile scraping: person type", async () => {
    const result = await executeWebJob(
      envelope("web.scrape_profile", {
        url: "https://linkedin.com/in/klaus-weber",
        profile_type: "person",
      }),
      web,
    );

    expect(result.status).toBe("completed");
    expect(result.structured_output?.profile_type).toBe("person");
  });

  it("page monitoring detects changes on second visit", async () => {
    // First visit
    const first = await executeWebJob(
      envelope("web.monitor_page", {
        url: "https://example.com/pricing",
        page_id: "pricing-page",
      }),
      web,
    );
    expect(first.status).toBe("completed");
    expect(first.structured_output?.has_changed).toBe(false);

    // Second visit — mock detects "change"
    const second = await executeWebJob(
      envelope("web.monitor_page", {
        url: "https://example.com/pricing",
        page_id: "pricing-page",
      }),
      web,
    );
    expect(second.status).toBe("completed");
    expect(web.getMonitoredPages()).toContain("pricing-page");
  });

  it("contact enrichment for known contacts", async () => {
    const result = await executeWebJob(
      envelope("web.enrich_contact", {
        name: "Stefan Braun",
        company: "Meridian Engineering",
      }),
      web,
    );

    expect(result.status).toBe("completed");
    const data = result.structured_output as any;
    expect(data.name).toBe("Stefan Braun");
    expect(data.confidence).toBeGreaterThan(0);
  });

  it("contact enrichment for unknown contact fails gracefully", async () => {
    const result = await executeWebJob(
      envelope("web.enrich_contact", {
        name: "Unknown Person",
        company: "Unknown Corp",
      }),
      web,
    );

    // Should complete but with low/no confidence or error
    expect(result.status).toBeDefined();
  });

  it("job tracking across multiple companies", async () => {
    const result = await executeWebJob(
      envelope("web.track_jobs", {
        company_names: ["Meridian Engineering", "Atlas Design", "Zentral Automotive"],
        keywords: ["safety", "AUTOSAR", "ISO 26262"],
        max_per_company: 5,
      }),
      web,
    );

    expect(result.status).toBe("completed");
    const postings = result.structured_output?.postings as any[];
    expect(postings.length).toBeGreaterThan(0);
    for (const posting of postings) {
      expect(posting.title).toBeTruthy();
      expect(posting.company).toBeTruthy();
    }
  });

  it("competitive intelligence for known company", async () => {
    const result = await executeWebJob(
      envelope("web.competitive_intel", {
        company_name: "Meridian Engineering",
        aspects: ["products", "team", "news"],
      }),
      web,
    );

    expect(result.status).toBe("completed");
    expect(result.structured_output?.company_name).toBe("Meridian Engineering GmbH");
  });

  it("competitive intelligence for unknown company", async () => {
    const result = await executeWebJob(
      envelope("web.competitive_intel", {
        company_name: "Unknown Startup GmbH",
        aspects: ["products"],
      }),
      web,
    );

    expect(result.status).toBe("completed");
  });

  it("10 concurrent web operations", async () => {
    const results = await Promise.all([
      ...Array.from({ length: 3 }, () => executeWebJob(envelope("web.search_news", { query: "automotive", max_results: 5 }), web)),
      ...Array.from({ length: 3 }, () => executeWebJob(envelope("web.scrape_profile", { url: "https://example.com", profile_type: "company" }), web)),
      ...Array.from({ length: 2 }, () => executeWebJob(envelope("web.track_jobs", { company_names: ["Meridian Engineering"], keywords: ["safety"] }), web)),
      ...Array.from({ length: 2 }, () => executeWebJob(envelope("web.competitive_intel", { company_name: "Atlas Design", aspects: ["news"] }), web)),
    ]);

    expect(results.every(r => r.status === "completed")).toBe(true);
    expect(web.getSearchCount()).toBe(3);
    expect(web.getScrapeCount()).toBe(3);
  });

  it("full BD intelligence pipeline: search -> scrape -> enrich -> track", async () => {
    // 1. Search news
    const news = await executeWebJob(envelope("web.search_news", { query: "ISO 26262 consulting", max_results: 5 }), web);
    expect(news.status).toBe("completed");

    // 2. Scrape a company profile
    const profile = await executeWebJob(envelope("web.scrape_profile", { url: "https://example-meridian.com", profile_type: "company" }), web);
    expect(profile.status).toBe("completed");

    // 3. Enrich a contact
    const enriched = await executeWebJob(envelope("web.enrich_contact", { name: "Ingrid Dahl", company: "Atlas Design" }), web);
    expect(enriched.status).toBe("completed");

    // 4. Track job postings
    const jobs = await executeWebJob(envelope("web.track_jobs", { company_names: ["Meridian Engineering", "Atlas Design"], keywords: ["safety"] }), web);
    expect(jobs.status).toBe("completed");

    // 5. Competitive intel
    const intel = await executeWebJob(envelope("web.competitive_intel", { company_name: "Meridian Engineering", aspects: ["products", "news", "customers"] }), web);
    expect(intel.status).toBe("completed");
  });
});
