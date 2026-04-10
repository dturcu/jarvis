import type { ExecutionOutcome, WebAdapter } from "./adapter.js";
import { WebWorkerError } from "./adapter.js";
import type {
  JobPosting,
  NewsArticle,
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
  WebTrackJobsOutput
} from "./types.js";

const MOCK_ARTICLES: NewsArticle[] = [
  {
    title: "Meridian Engineering GmbH Expands AUTOSAR Software Team Amid Safety Push",
    url: "https://www.automotive-engineering.example.com/meridian-autosar-expansion",
    source: "Automotive Engineering Today",
    published_at: "2026-03-28T09:00:00Z",
    snippet: "Meridian Engineering GmbH has announced a significant hiring push in its AUTOSAR and functional safety division, targeting ISO 26262 ASIL-D expertise across Munich and Stuttgart.",
    relevance_score: 0.95
  },
  {
    title: "Atlas Design Engineering Group Wins Chassis Safety Validation Contract for Tier 1",
    url: "https://www.automotiveworld.de/edag-chassis-safety-contract",
    source: "AutomotiveWorld DE",
    published_at: "2026-03-25T14:30:00Z",
    snippet: "Atlas Design Engineering Group secured a multi-year chassis validation program with a major German Tier 1 supplier, focused on ISO 26262 compliance and automated FMEA tooling integration.",
    relevance_score: 0.88
  },
  {
    title: "Zentral Automotive Doubles Down on Autonomous Safety Architecture Hiring",
    url: "https://zentral-auto-careers.example.com/news/safety-architecture-2026",
    source: "Zentral Automotive Careers",
    published_at: "2026-03-20T11:00:00Z",
    snippet: "Zentral Automotive GmbH is targeting 200 additional safety architecture engineers for its ADAS unit, with a focus on AUTOSAR Adaptive, SOTIF, and cybersecurity per UN R155.",
    relevance_score: 0.82
  }
];

const MOCK_JOB_POSTINGS: JobPosting[] = [
  {
    company: "Meridian Engineering GmbH",
    title: "Safety Engineer AUTOSAR (m/w/d)",
    location: "Munich, Germany",
    posted_at: "2026-03-30T08:00:00Z",
    url: "https://jobs.example-meridian.com/safety-engineer-autosar-munich",
    keywords_matched: ["AUTOSAR", "ISO 26262", "safety"],
    relevance_score: 0.97
  },
  {
    company: "Atlas Design Engineering Group",
    title: "Functional Safety Consultant ISO 26262",
    location: "Fulda, Germany",
    posted_at: "2026-03-29T10:00:00Z",
    url: "https://www.example-atlas.com/careers/functional-safety-consultant",
    keywords_matched: ["ISO 26262", "safety"],
    relevance_score: 0.91
  },
  {
    company: "Sigma Components GmbH",
    title: "AUTOSAR Software Integration Engineer",
    location: "Stuttgart, Germany",
    posted_at: "2026-03-27T09:30:00Z",
    url: "https://careers.example-sigma.com/autosar-software-integration",
    keywords_matched: ["AUTOSAR"],
    relevance_score: 0.85
  }
];

export class MockWebAdapter implements WebAdapter {
  private searchCount = 0;
  private scrapeCount = 0;
  private monitoredPages: Map<string, number> = new Map();

  getSearchCount(): number {
    return this.searchCount;
  }

  getScrapeCount(): number {
    return this.scrapeCount;
  }

  getMonitoredPages(): string[] {
    return [...this.monitoredPages.keys()];
  }

  async searchNews(
    input: WebSearchNewsInput,
  ): Promise<ExecutionOutcome<WebSearchNewsOutput>> {
    this.searchCount++;
    const maxResults = input.max_results ?? 10;
    const articles = MOCK_ARTICLES.slice(0, Math.min(maxResults, MOCK_ARTICLES.length));

    return {
      summary: `Found ${articles.length} news articles for query "${input.query}".`,
      structured_output: {
        articles,
        query: input.query,
        total_found: articles.length
      }
    };
  }

  async scrapeProfile(
    input: WebScrapeProfileInput,
  ): Promise<ExecutionOutcome<WebScrapeProfileOutput>> {
    this.scrapeCount++;
    const scrapedAt = new Date().toISOString();

    let data: Record<string, unknown>;

    if (input.profile_type === "company") {
      data = {
        name: "Meridian Engineering GmbH",
        industry: "Engineering Services",
        employees: "13000+",
        headquarters: "Ehningen, Germany",
        founded: "1974",
        specializations: ["AUTOSAR", "ISO 26262", "Functional Safety", "Chassis Development"],
        clients: ["Apex Motors", "Mercedes-Benz", "Volkswagen Group", "Zentral Automotive"],
        website: input.url
      };
    } else if (input.profile_type === "person") {
      data = {
        name: "Dr. Stefan Braun",
        title: "Head of Functional Safety",
        company: "Meridian Engineering GmbH",
        location: "Munich, Germany",
        experience_years: 18,
        certifications: ["ISO 26262 Functional Safety Engineer", "AUTOSAR Expert"],
        profile_url: input.url
      };
    } else {
      data = {
        title: "Senior Safety Engineer AUTOSAR (m/w/d)",
        company: "Zentral Automotive GmbH",
        location: "Regensburg, Germany",
        salary_range: "70000-95000 EUR",
        requirements: ["AUTOSAR Classic", "ISO 26262 ASIL-D", "5+ years experience"],
        posted_at: "2026-04-01T08:00:00Z",
        url: input.url
      };
    }

    if (input.extract_fields && input.extract_fields.length > 0) {
      const filtered: Record<string, unknown> = {};
      for (const field of input.extract_fields) {
        if (field in data) {
          filtered[field] = data[field];
        }
      }
      data = filtered;
    }

    return {
      summary: `Scraped ${input.profile_type} profile from ${input.url}.`,
      structured_output: {
        url: input.url,
        profile_type: input.profile_type,
        data,
        scraped_at: scrapedAt
      }
    };
  }

  async monitorPage(
    input: WebMonitorPageInput,
  ): Promise<ExecutionOutcome<WebMonitorPageOutput>> {
    const checkedAt = new Date().toISOString();
    const visitCount = (this.monitoredPages.get(input.page_id) ?? 0) + 1;
    this.monitoredPages.set(input.page_id, visitCount);

    const currentHash = `sha256-${input.page_id}-v${visitCount}`;
    const previousHash = visitCount > 1 ? `sha256-${input.page_id}-v${visitCount - 1}` : undefined;
    const hasChanged = visitCount > 1;

    return {
      summary: hasChanged
        ? `Page ${input.page_id} has changed since last check.`
        : `Page ${input.page_id} has not changed.`,
      structured_output: {
        url: input.url,
        page_id: input.page_id,
        has_changed: hasChanged,
        change_summary: hasChanged ? "Content updated since last monitoring cycle." : undefined,
        current_hash: currentHash,
        previous_hash: previousHash,
        checked_at: checkedAt
      }
    };
  }

  async enrichContact(
    input: WebEnrichContactInput,
  ): Promise<ExecutionOutcome<WebEnrichContactOutput>> {
    const enrichedAt = new Date().toISOString();

    // Known contacts return full enrichment; others throw
    const knownContacts: Record<string, WebEnrichContactOutput> = {
      "Stefan Braun": {
        name: "Stefan Braun",
        email: "s.braun@meridian-eng.example.com",
        company: "Meridian Engineering GmbH",
        role: "Head of Functional Safety",
        linkedin_url: "https://linkedin.com/in/stefanbraun-autosar",
        company_size: "10001+",
        industry: "Engineering Services",
        location: "Munich, Germany",
        enriched_at: enrichedAt,
        confidence: 0.92
      },
      "Ingrid Dahl": {
        name: "Ingrid Dahl",
        email: "i.dahl@example-atlas.com",
        company: "Atlas Design Engineering Group",
        role: "Senior Functional Safety Engineer",
        linkedin_url: "https://linkedin.com/in/ingriddahl-safety",
        company_size: "5001-10000",
        industry: "Engineering Services",
        location: "Fulda, Germany",
        enriched_at: enrichedAt,
        confidence: 0.88
      }
    };

    const match = knownContacts[input.name];
    if (!match) {
      throw new WebWorkerError(
        "CONTACT_NOT_FOUND",
        `No enrichment data found for contact: ${input.name}.`,
        false,
        { name: input.name }
      );
    }

    return {
      summary: `Enriched contact "${input.name}" with web data (confidence: ${match.confidence}).`,
      structured_output: { ...match, enriched_at: enrichedAt }
    };
  }

  async trackJobs(
    input: WebTrackJobsInput,
  ): Promise<ExecutionOutcome<WebTrackJobsOutput>> {
    const scannedAt = new Date().toISOString();
    const maxPerCompany = input.max_per_company ?? 5;

    const filtered = MOCK_JOB_POSTINGS.filter((posting) => {
      const companyMatch = input.company_names.some((c) =>
        posting.company.toLowerCase().includes(c.toLowerCase())
      );
      const keywordMatch = input.keywords.some((kw) =>
        posting.keywords_matched.some((k) =>
          k.toLowerCase().includes(kw.toLowerCase())
        )
      );
      return companyMatch || keywordMatch;
    });

    // Apply per-company limit
    const companyCount: Record<string, number> = {};
    const limited = filtered.filter((p) => {
      companyCount[p.company] = (companyCount[p.company] ?? 0) + 1;
      return (companyCount[p.company] ?? 0) <= maxPerCompany;
    });

    return {
      summary: `Found ${limited.length} job posting(s) matching keywords [${input.keywords.join(", ")}] at ${input.company_names.length} target company/companies.`,
      structured_output: {
        postings: limited,
        total_found: limited.length,
        companies_searched: input.company_names,
        scanned_at: scannedAt
      }
    };
  }

  async competitiveIntel(
    input: WebCompetitiveIntelInput,
  ): Promise<ExecutionOutcome<WebCompetitiveIntelOutput>> {
    const intelGatheredAt = new Date().toISOString();

    const knownCompanies: Record<string, Omit<WebCompetitiveIntelOutput, "intel_gathered_at">> = {
      "Meridian Engineering": {
        company_name: "Meridian Engineering GmbH",
        summary: "Meridian Engineering GmbH is a leading German engineering services company with deep expertise in AUTOSAR, functional safety (ISO 26262), and chassis development. The company serves all major German OEMs and is aggressively expanding its safety software competency center.",
        key_facts: [
          "13,000+ employees across 50+ locations",
          "Strong focus on ISO 26262 ASIL-D certification services",
          "Recent 200-engineer hiring push in Munich for safety software",
          "Strategic partnership with Vector Informatik for AUTOSAR tooling",
          "Revenue ~1.2B EUR in FY2025"
        ],
        recent_news: MOCK_ARTICLES.filter((a) => a.title.includes("Meridian Engineering"))
      },
      "Atlas Design": {
        company_name: "Atlas Design Engineering Group",
        summary: "Atlas Design is a global automotive engineering partner specializing in vehicle development, production solutions, and electrification. Strong competitor in functional safety validation and homologation services.",
        key_facts: [
          "8,000+ engineers in 50+ locations worldwide",
          "Specialized FMEA automation and hazard analysis tooling",
          "Growing autonomous vehicle validation practice",
          "Recent Tier 1 chassis safety validation win"
        ],
        recent_news: MOCK_ARTICLES.filter((a) => a.title.includes("Atlas Design"))
      }
    };

    const match = Object.entries(knownCompanies).find(([key]) =>
      input.company_name.toLowerCase().includes(key.toLowerCase())
    );

    if (!match) {
      // Return minimal intel for unknown companies
      return {
        summary: `Limited intelligence available for ${input.company_name}.`,
        structured_output: {
          company_name: input.company_name,
          summary: `No detailed intelligence available for ${input.company_name} in the mock data store.`,
          key_facts: [],
          recent_news: [],
          intel_gathered_at: intelGatheredAt
        }
      };
    }

    const [, intel] = match;
    return {
      summary: `Gathered competitive intelligence on ${intel.company_name}: ${intel.key_facts.length} key facts, ${intel.recent_news.length} recent news items.`,
      structured_output: {
        ...intel,
        intel_gathered_at: intelGatheredAt
      }
    };
  }
}

export function createMockWebAdapter(): WebAdapter {
  return new MockWebAdapter();
}
