import { beforeEach, describe, expect, it } from "vitest";
import {
  CONTRACT_VERSION,
  resetJarvisState
} from "@jarvis/shared";
import {
  MockWebAdapter,
  createMockWebAdapter,
  createWebWorker,
  executeWebJob,
  isWebJobType,
  WEB_JOB_TYPES
} from "@jarvis/web-worker";
import type { JobEnvelope } from "@jarvis/shared";

function makeEnvelope(
  type: string,
  input: Record<string, unknown> = {},
  overrides: Partial<JobEnvelope> = {},
): JobEnvelope {
  return {
    contract_version: CONTRACT_VERSION,
    job_id: `test-${Math.random().toString(36).slice(2)}`,
    type: type as JobEnvelope["type"],
    session_key: "agent:main:api:local:adhoc",
    requested_by: { channel: "api", user_id: "test-user" },
    priority: "normal",
    approval_state: "not_required",
    timeout_seconds: 300,
    attempt: 1,
    input,
    artifacts_in: [],
    retry_policy: { mode: "manual", max_attempts: 3 },
    metadata: {
      agent_id: "main",
      thread_key: null
    },
    ...overrides
  };
}

describe("WEB_JOB_TYPES", () => {
  it("contains all 6 web job types", () => {
    expect(WEB_JOB_TYPES).toHaveLength(6);
    expect(WEB_JOB_TYPES).toContain("web.search_news");
    expect(WEB_JOB_TYPES).toContain("web.scrape_profile");
    expect(WEB_JOB_TYPES).toContain("web.monitor_page");
    expect(WEB_JOB_TYPES).toContain("web.enrich_contact");
    expect(WEB_JOB_TYPES).toContain("web.track_jobs");
    expect(WEB_JOB_TYPES).toContain("web.competitive_intel");
  });
});

describe("isWebJobType", () => {
  it("returns true for known web job types", () => {
    for (const type of WEB_JOB_TYPES) {
      expect(isWebJobType(type)).toBe(true);
    }
  });

  it("returns false for unknown job types", () => {
    expect(isWebJobType("system.monitor_cpu")).toBe(false);
    expect(isWebJobType("email.search")).toBe(false);
    expect(isWebJobType("unknown.job")).toBe(false);
    expect(isWebJobType("")).toBe(false);
  });
});

describe("MockWebAdapter", () => {
  let adapter: MockWebAdapter;

  beforeEach(() => {
    adapter = new MockWebAdapter();
  });

  describe("searchNews", () => {
    it("returns articles for a query", async () => {
      const result = await adapter.searchNews({ query: "Meridian Engineering AUTOSAR safety" });
      expect(result.structured_output.query).toBe("Meridian Engineering AUTOSAR safety");
      expect(result.structured_output.articles.length).toBeGreaterThan(0);
      expect(result.structured_output.total_found).toBe(result.structured_output.articles.length);
    });

    it("respects max_results", async () => {
      const result = await adapter.searchNews({ query: "automotive safety", max_results: 1 });
      expect(result.structured_output.articles.length).toBeLessThanOrEqual(1);
    });

    it("each article has required fields", async () => {
      const result = await adapter.searchNews({ query: "Atlas Design functional safety" });
      const article = result.structured_output.articles[0]!;
      expect(article).toMatchObject({
        title: expect.any(String),
        url: expect.any(String),
        source: expect.any(String),
        published_at: expect.any(String),
        snippet: expect.any(String),
        relevance_score: expect.any(Number)
      });
      expect(article.relevance_score).toBeGreaterThanOrEqual(0);
      expect(article.relevance_score).toBeLessThanOrEqual(1);
    });

    it("increments search count", async () => {
      expect(adapter.getSearchCount()).toBe(0);
      await adapter.searchNews({ query: "test" });
      await adapter.searchNews({ query: "test2" });
      expect(adapter.getSearchCount()).toBe(2);
    });
  });

  describe("scrapeProfile", () => {
    it("returns company profile data", async () => {
      const result = await adapter.scrapeProfile({
        url: "https://www.example-meridian.com/about",
        profile_type: "company"
      });
      expect(result.structured_output.profile_type).toBe("company");
      expect(result.structured_output.url).toBe("https://www.example-meridian.com/about");
      expect(result.structured_output.data).toBeDefined();
      expect(result.structured_output.scraped_at).toBeTruthy();
    });

    it("returns person profile data", async () => {
      const result = await adapter.scrapeProfile({
        url: "https://linkedin.com/in/klausweber",
        profile_type: "person"
      });
      expect(result.structured_output.profile_type).toBe("person");
      expect(result.structured_output.data).toMatchObject({
        name: expect.any(String)
      });
    });

    it("respects extract_fields filter", async () => {
      const result = await adapter.scrapeProfile({
        url: "https://www.example-meridian.com/about",
        profile_type: "company",
        extract_fields: ["name", "industry"]
      });
      const data = result.structured_output.data;
      expect(data.name).toBeDefined();
      expect(data.industry).toBeDefined();
      expect(data.employees).toBeUndefined();
    });

    it("increments scrape count", async () => {
      expect(adapter.getScrapeCount()).toBe(0);
      await adapter.scrapeProfile({ url: "https://example.com", profile_type: "company" });
      expect(adapter.getScrapeCount()).toBe(1);
    });
  });

  describe("monitorPage", () => {
    it("reports no change on first visit", async () => {
      const result = await adapter.monitorPage({
        url: "https://careers.example-meridian.com/safety-jobs",
        page_id: "meridian-safety-unique-test"
      });
      expect(result.structured_output.has_changed).toBe(false);
      expect(result.structured_output.previous_hash).toBeUndefined();
      expect(result.structured_output.current_hash).toBeTruthy();
    });

    it("reports change on second visit to same page_id", async () => {
      const pageId = "test-page-monitor-change";
      await adapter.monitorPage({ url: "https://example.com", page_id: pageId });
      const result2 = await adapter.monitorPage({ url: "https://example.com", page_id: pageId });
      expect(result2.structured_output.has_changed).toBe(true);
      expect(result2.structured_output.previous_hash).toBeDefined();
    });

    it("tracks monitored pages", async () => {
      await adapter.monitorPage({ url: "https://example.com/page1", page_id: "page-monitor-1" });
      await adapter.monitorPage({ url: "https://example.com/page2", page_id: "page-monitor-2" });
      expect(adapter.getMonitoredPages()).toContain("page-monitor-1");
      expect(adapter.getMonitoredPages()).toContain("page-monitor-2");
    });
  });

  describe("enrichContact", () => {
    it("enriches a known contact", async () => {
      const result = await adapter.enrichContact({ name: "Stefan Braun", company: "Meridian Engineering GmbH" });
      expect(result.structured_output.name).toBe("Stefan Braun");
      expect(result.structured_output.company).toBe("Meridian Engineering GmbH");
      expect(result.structured_output.role).toBeDefined();
      expect(result.structured_output.confidence).toBeGreaterThan(0);
      expect(result.structured_output.confidence).toBeLessThanOrEqual(1);
      expect(result.structured_output.enriched_at).toBeTruthy();
    });

    it("enriches a second known contact", async () => {
      const result = await adapter.enrichContact({ name: "Ingrid Dahl" });
      expect(result.structured_output.name).toBe("Ingrid Dahl");
      expect(result.structured_output.email).toBeDefined();
    });

    it("throws WebWorkerError for unknown contact", async () => {
      await expect(
        adapter.enrichContact({ name: "Unknown Person XYZ" })
      ).rejects.toMatchObject({
        code: "CONTACT_NOT_FOUND"
      });
    });
  });

  describe("trackJobs", () => {
    it("returns job postings for known companies", async () => {
      const result = await adapter.trackJobs({
        company_names: ["Meridian Engineering GmbH", "Atlas Design Engineering Group"],
        keywords: ["AUTOSAR", "ISO 26262"]
      });
      expect(result.structured_output.postings.length).toBeGreaterThan(0);
      expect(result.structured_output.total_found).toBe(result.structured_output.postings.length);
      expect(result.structured_output.companies_searched).toContain("Meridian Engineering GmbH");
      expect(result.structured_output.scanned_at).toBeTruthy();
    });

    it("each posting has correct shape", async () => {
      const result = await adapter.trackJobs({
        company_names: ["Meridian Engineering GmbH"],
        keywords: ["AUTOSAR"]
      });
      const posting = result.structured_output.postings[0]!;
      expect(posting).toMatchObject({
        company: expect.any(String),
        title: expect.any(String),
        location: expect.any(String),
        posted_at: expect.any(String),
        url: expect.any(String),
        keywords_matched: expect.any(Array),
        relevance_score: expect.any(Number)
      });
    });

    it("respects max_per_company limit", async () => {
      const result = await adapter.trackJobs({
        company_names: ["Meridian Engineering GmbH", "Atlas Design Engineering Group", "Sigma Components GmbH"],
        keywords: ["AUTOSAR", "safety", "ISO 26262"],
        max_per_company: 1
      });
      const companyCounts: Record<string, number> = {};
      for (const posting of result.structured_output.postings) {
        companyCounts[posting.company] = (companyCounts[posting.company] ?? 0) + 1;
      }
      for (const count of Object.values(companyCounts)) {
        expect(count).toBeLessThanOrEqual(1);
      }
    });
  });

  describe("competitiveIntel", () => {
    it("returns intel for a known company", async () => {
      const result = await adapter.competitiveIntel({ company_name: "Meridian Engineering" });
      expect(result.structured_output.company_name).toBe("Meridian Engineering GmbH");
      expect(result.structured_output.summary.length).toBeGreaterThan(0);
      expect(result.structured_output.key_facts.length).toBeGreaterThan(0);
      expect(result.structured_output.intel_gathered_at).toBeTruthy();
    });

    it("returns intel for Atlas Design", async () => {
      const result = await adapter.competitiveIntel({ company_name: "Atlas Design" });
      expect(result.structured_output.company_name).toBe("Atlas Design Engineering Group");
      expect(result.structured_output.key_facts.length).toBeGreaterThan(0);
    });

    it("returns minimal intel for unknown company", async () => {
      const result = await adapter.competitiveIntel({ company_name: "UnknownCorpXYZ999" });
      expect(result.structured_output.company_name).toBe("UnknownCorpXYZ999");
      expect(result.structured_output.key_facts).toHaveLength(0);
      expect(result.structured_output.recent_news).toHaveLength(0);
    });
  });
});

describe("executeWebJob", () => {
  let adapter: MockWebAdapter;

  beforeEach(() => {
    resetJarvisState();
    adapter = new MockWebAdapter();
  });

  it("produces a completed JobResult for web.search_news", async () => {
    const envelope = makeEnvelope("web.search_news", {
      query: "Meridian Engineering AUTOSAR safety"
    });
    const result = await executeWebJob(envelope, adapter);

    expect(result.contract_version).toBe(CONTRACT_VERSION);
    expect(result.job_id).toBe(envelope.job_id);
    expect(result.job_type).toBe("web.search_news");
    expect(result.status).toBe("completed");
    expect(result.attempt).toBe(1);
    expect(result.metrics?.worker_id).toBe("web-worker");
    expect(result.metrics?.started_at).toBeTruthy();
    const out = result.structured_output as Record<string, unknown>;
    expect(out.query).toBe("Meridian Engineering AUTOSAR safety");
    expect(Array.isArray(out.articles)).toBe(true);
  });

  it("produces a completed JobResult for web.scrape_profile", async () => {
    const envelope = makeEnvelope("web.scrape_profile", {
      url: "https://www.example-meridian.com",
      profile_type: "company"
    });
    const result = await executeWebJob(envelope, adapter);

    expect(result.status).toBe("completed");
    expect(result.job_type).toBe("web.scrape_profile");
    const out = result.structured_output as Record<string, unknown>;
    expect(out.profile_type).toBe("company");
  });

  it("produces a completed JobResult for web.monitor_page", async () => {
    const envelope = makeEnvelope("web.monitor_page", {
      url: "https://careers.example-meridian.com",
      page_id: "execute-test-page"
    });
    const result = await executeWebJob(envelope, adapter);

    expect(result.status).toBe("completed");
    expect(result.job_type).toBe("web.monitor_page");
    const out = result.structured_output as Record<string, unknown>;
    expect(typeof out.has_changed).toBe("boolean");
    expect(typeof out.current_hash).toBe("string");
  });

  it("produces a completed JobResult for web.enrich_contact", async () => {
    const envelope = makeEnvelope("web.enrich_contact", {
      name: "Stefan Braun",
      company: "Meridian Engineering GmbH"
    });
    const result = await executeWebJob(envelope, adapter);

    expect(result.status).toBe("completed");
    expect(result.job_type).toBe("web.enrich_contact");
    const out = result.structured_output as Record<string, unknown>;
    expect(out.name).toBe("Stefan Braun");
    expect(typeof out.confidence).toBe("number");
  });

  it("produces a completed JobResult for web.track_jobs", async () => {
    const envelope = makeEnvelope("web.track_jobs", {
      company_names: ["Meridian Engineering GmbH", "Atlas Design Engineering Group"],
      keywords: ["AUTOSAR", "safety"]
    });
    const result = await executeWebJob(envelope, adapter);

    expect(result.status).toBe("completed");
    expect(result.job_type).toBe("web.track_jobs");
    const out = result.structured_output as Record<string, unknown>;
    expect(Array.isArray(out.postings)).toBe(true);
    expect(typeof out.total_found).toBe("number");
  });

  it("produces a completed JobResult for web.competitive_intel", async () => {
    const envelope = makeEnvelope("web.competitive_intel", {
      company_name: "Meridian Engineering"
    });
    const result = await executeWebJob(envelope, adapter);

    expect(result.status).toBe("completed");
    expect(result.job_type).toBe("web.competitive_intel");
    const out = result.structured_output as Record<string, unknown>;
    expect(typeof out.summary).toBe("string");
    expect(Array.isArray(out.key_facts)).toBe(true);
  });

  it("returns failed status for unsupported job type", async () => {
    const envelope = makeEnvelope("system.monitor_cpu", {});
    const result = await executeWebJob(envelope, adapter);

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("INVALID_INPUT");
    expect(result.error?.message).toContain("system.monitor_cpu");
    expect(result.error?.retryable).toBe(false);
  });

  it("wraps WebWorkerError (CONTACT_NOT_FOUND) into failed result", async () => {
    const envelope = makeEnvelope("web.enrich_contact", {
      name: "Unknown Person XYZ"
    });
    const result = await executeWebJob(envelope, adapter);

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("CONTACT_NOT_FOUND");
    expect(result.error?.retryable).toBe(false);
  });

  it("wraps generic Error into INTERNAL_ERROR", async () => {
    const faultyAdapter = new MockWebAdapter();
    (faultyAdapter as unknown as { searchNews: unknown }).searchNews = async () => {
      throw new Error("Network timeout");
    };

    const envelope = makeEnvelope("web.search_news", { query: "test" });
    const result = await executeWebJob(envelope, faultyAdapter);

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("INTERNAL_ERROR");
    expect(result.error?.message).toBe("Network timeout");
  });

  it("uses custom workerId when provided", async () => {
    const envelope = makeEnvelope("web.search_news", { query: "test" });
    const result = await executeWebJob(envelope, adapter, {
      workerId: "custom-web-worker"
    });

    expect(result.status).toBe("completed");
    expect(result.metrics?.worker_id).toBe("custom-web-worker");
  });
});

describe("createWebWorker", () => {
  beforeEach(() => {
    resetJarvisState();
  });

  it("exposes a default workerId", () => {
    const worker = createWebWorker({ adapter: createMockWebAdapter() });
    expect(worker.workerId).toBe("web-worker");
  });

  it("uses the provided workerId", () => {
    const worker = createWebWorker({
      adapter: createMockWebAdapter(),
      workerId: "my-web-worker"
    });
    expect(worker.workerId).toBe("my-web-worker");
  });

  it("executes a job via the worker facade", async () => {
    const worker = createWebWorker({ adapter: createMockWebAdapter() });
    const envelope = makeEnvelope("web.search_news", {
      query: "Zentral Automotive safety architecture"
    });
    const result = await worker.execute(envelope);

    expect(result.status).toBe("completed");
    expect(result.metrics?.worker_id).toBe("web-worker");
    const out = result.structured_output as Record<string, unknown>;
    expect(Array.isArray(out.articles)).toBe(true);
  });

  it("mock state is reset between adapter instances", async () => {
    const adapter1 = new MockWebAdapter();
    const adapter2 = new MockWebAdapter();

    await adapter1.searchNews({ query: "test" });
    await adapter1.searchNews({ query: "test" });
    expect(adapter1.getSearchCount()).toBe(2);
    expect(adapter2.getSearchCount()).toBe(0);
  });
});
