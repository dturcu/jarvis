import type { OpenClawPluginToolContext } from "openclaw/plugin-sdk/plugin-entry";
import { getJarvisState } from "./state.js";
import type { ToolResponse } from "./types.js";

export type WebSearchNewsParams = {
  query: string;
  sources?: string[];
  max_results?: number;
  date_from?: string;
};

export type WebScrapeProfileParams = {
  url: string;
  profile_type?: "company" | "person" | "job_posting";
  extract_fields?: string[];
};

export type WebMonitorPageParams = {
  url: string;
  page_id: string;
  selector?: string;
};

export type WebEnrichContactParams = {
  name: string;
  company?: string;
  email?: string;
  linkedin_url?: string;
};

export type WebTrackJobsParams = {
  company_names: string[];
  keywords: string[];
  max_per_company?: number;
};

export type WebCompetitiveIntelParams = {
  company_name: string;
  aspects?: Array<"products" | "pricing" | "team" | "news" | "customers">;
};

export function submitWebSearchNews(
  ctx: OpenClawPluginToolContext | undefined,
  params: WebSearchNewsParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "web.search_news",
    input: {
      query: params.query,
      sources: params.sources,
      max_results: params.max_results,
      date_from: params.date_from,
    }
  });
}

export function submitWebScrapeProfile(
  ctx: OpenClawPluginToolContext | undefined,
  params: WebScrapeProfileParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "web.scrape_profile",
    input: {
      url: params.url,
      profile_type: params.profile_type,
      extract_fields: params.extract_fields,
    }
  });
}

export function submitWebMonitorPage(
  ctx: OpenClawPluginToolContext | undefined,
  params: WebMonitorPageParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "web.monitor_page",
    input: {
      url: params.url,
      page_id: params.page_id,
      selector: params.selector,
    }
  });
}

export function submitWebEnrichContact(
  ctx: OpenClawPluginToolContext | undefined,
  params: WebEnrichContactParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "web.enrich_contact",
    input: {
      name: params.name,
      company: params.company,
      email: params.email,
      linkedin_url: params.linkedin_url,
    }
  });
}

export function submitWebTrackJobs(
  ctx: OpenClawPluginToolContext | undefined,
  params: WebTrackJobsParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "web.track_jobs",
    input: {
      company_names: params.company_names,
      keywords: params.keywords,
      max_per_company: params.max_per_company,
    }
  });
}

export function submitWebCompetitiveIntel(
  ctx: OpenClawPluginToolContext | undefined,
  params: WebCompetitiveIntelParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "web.competitive_intel",
    input: {
      company_name: params.company_name,
      aspects: params.aspects,
    }
  });
}
