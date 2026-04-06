import { Type } from "@sinclair/typebox";
import {
  definePluginEntry,
  type AnyAgentTool,
  type OpenClawPluginToolContext,
  type PluginCommandContext
} from "openclaw/plugin-sdk/plugin-entry";
import {
  WEB_TOOL_NAMES,
  WEB_COMMAND_NAMES,
  getJarvisState,
  safeJsonParse,
  submitWebSearchNews,
  submitWebScrapeProfile,
  submitWebMonitorPage,
  submitWebEnrichContact,
  submitWebTrackJobs,
  submitWebCompetitiveIntel,
  toCommandReply,
  toToolResult,
  type ToolResponse
} from "@jarvis/shared";

type WebCommandArgs = {
  operation:
    | "search_news"
    | "scrape_profile"
    | "monitor_page"
    | "enrich_contact"
    | "track_jobs"
    | "competitive_intel";
  query?: string;
  url?: string;
  profile_type?: "company" | "person" | "job_posting";
  page_id?: string;
  name?: string;
  company_name?: string;
  company_names?: string[];
  keywords?: string[];
};

type IntelCommandArgs = {
  company_name: string;
  aspects?: Array<"products" | "pricing" | "team" | "news" | "customers">;
};

function asLiteralUnion<const Values extends readonly [string, ...string[]]>(
  values: Values,
) {
  return Type.Union(values.map((value) => Type.Literal(value)) as [any, any, ...any[]]);
}

const profileTypeSchema = asLiteralUnion(["company", "person", "job_posting"] as const);
const intelAspectSchema = asLiteralUnion(["products", "pricing", "team", "news", "customers"] as const);

function createWebTool(
  ctx: OpenClawPluginToolContext,
  name: string,
  label: string,
  description: string,
  parameters: ReturnType<typeof Type.Object>,
  submit: (ctx: OpenClawPluginToolContext | undefined, params: any) => ToolResponse,
): AnyAgentTool {
  return {
    name,
    label,
    description,
    parameters,
    execute: async (_toolCallId, params) => toToolResult(submit(ctx, params))
  };
}

export function createWebTools(
  ctx: OpenClawPluginToolContext,
): AnyAgentTool[] {
  return [
    createWebTool(
      ctx,
      "web_search_news",
      "Web Search News",
      "Search news and web for a company or topic. Returns ranked news articles with relevance scores.",
      Type.Object({
        query: Type.String({ minLength: 1, description: "Search query, e.g. 'Bertrandt AUTOSAR safety'" }),
        max_results: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, description: "Maximum number of results to return (default 10)." })),
        date_from: Type.Optional(Type.String({ description: "ISO date to filter articles published after this date." })),
        sources: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { description: "Preferred news sources." }))
      }),
      (toolCtx, params) => submitWebSearchNews(toolCtx, params)
    ),
    createWebTool(
      ctx,
      "web_scrape_profile",
      "Web Scrape Profile",
      "Extract company, person, or job posting profile data from a URL.",
      Type.Object({
        url: Type.String({ minLength: 1, description: "URL to scrape." }),
        profile_type: profileTypeSchema,
        extract_fields: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { description: "Specific fields to extract." }))
      }),
      (toolCtx, params) => submitWebScrapeProfile(toolCtx, params)
    ),
    createWebTool(
      ctx,
      "web_monitor_page",
      "Web Monitor Page",
      "Check a web page for changes since the last monitoring run.",
      Type.Object({
        url: Type.String({ minLength: 1, description: "URL to monitor." }),
        page_id: Type.String({ minLength: 1, description: "Stable identifier for tracking this page across runs." }),
        selector: Type.Optional(Type.String({ minLength: 1, description: "CSS selector to limit monitoring to a specific section." }))
      }),
      (toolCtx, params) => submitWebMonitorPage(toolCtx, params)
    ),
    createWebTool(
      ctx,
      "web_enrich_contact",
      "Web Enrich Contact",
      "Enrich a contact record with web data including role, company, LinkedIn, and industry info.",
      Type.Object({
        name: Type.String({ minLength: 1, description: "Full name of the contact." }),
        company: Type.Optional(Type.String({ minLength: 1, description: "Contact's current company." })),
        email: Type.Optional(Type.String({ minLength: 1, description: "Contact's email address." })),
        linkedin_url: Type.Optional(Type.String({ minLength: 1, description: "Contact's LinkedIn profile URL." }))
      }),
      (toolCtx, params) => submitWebEnrichContact(toolCtx, params)
    ),
    createWebTool(
      ctx,
      "web_track_jobs",
      "Web Track Jobs",
      "Monitor job postings at target companies matching specified keywords.",
      Type.Object({
        company_names: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, description: "List of company names to monitor." }),
        keywords: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, description: "Keywords to match, e.g. [\"AUTOSAR\", \"ISO 26262\", \"safety\"]." }),
        max_per_company: Type.Optional(Type.Integer({ minimum: 1, description: "Maximum postings to return per company." }))
      }),
      (toolCtx, params) => submitWebTrackJobs(toolCtx, params)
    ),
    createWebTool(
      ctx,
      "web_competitive_intel",
      "Web Competitive Intel",
      "Gather competitive intelligence on a company including products, team, news, and key facts.",
      Type.Object({
        company_name: Type.String({ minLength: 1, description: "Name of the company to research." }),
        aspects: Type.Optional(Type.Array(intelAspectSchema, { description: "Specific intelligence aspects to focus on." }))
      }),
      (toolCtx, params) => submitWebCompetitiveIntel(toolCtx, params)
    )
  ];
}

function formatJobReply(response: ToolResponse): string {
  const parts = [response.summary];
  if (response.job_id) {
    parts.push(`job=${response.job_id}`);
  }
  if (response.approval_id) {
    parts.push(`approval=${response.approval_id}`);
  }
  return parts.join(" | ");
}

function parseJsonArgs<T>(ctx: PluginCommandContext): T | null {
  return safeJsonParse<T>(ctx.args);
}

function toToolContext(ctx: PluginCommandContext): OpenClawPluginToolContext {
  return {
    sessionKey: ctx.sessionKey,
    sessionId: ctx.sessionId,
    messageChannel: ctx.channel,
    requesterSenderId: ctx.senderId
  };
}

function invalidJsonReply(commandName: string) {
  return toCommandReply(`Invalid JSON arguments for /${commandName}.`, true);
}

export function createWebCommand() {
  return {
    name: "web",
    description: "Web intelligence operations: search_news, scrape_profile, monitor_page, enrich_contact, track_jobs, competitive_intel.",
    acceptsArgs: true,
    handler: (ctx: PluginCommandContext) => {
      const args = parseJsonArgs<WebCommandArgs>(ctx);
      if (!args) {
        return invalidJsonReply("web");
      }

      const toolCtx = toToolContext(ctx);

      switch (args.operation) {
        case "search_news": {
          if (!args.query) return toCommandReply("Missing required field: query.", true);
          const response = submitWebSearchNews(toolCtx, { query: args.query });
          return toCommandReply(formatJobReply(response));
        }
        case "scrape_profile": {
          if (!args.url || !args.profile_type) return toCommandReply("Missing required fields: url, profile_type.", true);
          const response = submitWebScrapeProfile(toolCtx, { url: args.url, profile_type: args.profile_type });
          return toCommandReply(formatJobReply(response));
        }
        case "monitor_page": {
          if (!args.url || !args.page_id) return toCommandReply("Missing required fields: url, page_id.", true);
          const response = submitWebMonitorPage(toolCtx, { url: args.url, page_id: args.page_id });
          return toCommandReply(formatJobReply(response));
        }
        case "enrich_contact": {
          if (!args.name) return toCommandReply("Missing required field: name.", true);
          const response = submitWebEnrichContact(toolCtx, { name: args.name, company: args.company_name });
          return toCommandReply(formatJobReply(response));
        }
        case "track_jobs": {
          if (!args.company_names || !args.keywords) return toCommandReply("Missing required fields: company_names, keywords.", true);
          const response = submitWebTrackJobs(toolCtx, { company_names: args.company_names, keywords: args.keywords });
          return toCommandReply(formatJobReply(response));
        }
        case "competitive_intel": {
          if (!args.company_name) return toCommandReply("Missing required field: company_name.", true);
          const response = submitWebCompetitiveIntel(toolCtx, { company_name: args.company_name });
          return toCommandReply(formatJobReply(response));
        }
        default:
          return toCommandReply(
            `Unsupported /web operation: ${String((args as WebCommandArgs).operation)}. Valid operations: search_news, scrape_profile, monitor_page, enrich_contact, track_jobs, competitive_intel.`,
            true
          );
      }
    }
  };
}

export function createIntelCommand() {
  return {
    name: "intel",
    description: "Gather competitive intelligence on a company with JSON arguments: { company_name, aspects? }.",
    acceptsArgs: true,
    handler: (ctx: PluginCommandContext) => {
      const args = parseJsonArgs<IntelCommandArgs>(ctx);
      if (!args || !args.company_name) {
        return toCommandReply(`Usage: /intel {"company_name": "Bertrandt", "aspects": ["news", "team"]}`, true);
      }
      const toolCtx = toToolContext(ctx);
      const response = submitWebCompetitiveIntel(toolCtx, {
        company_name: args.company_name,
        aspects: args.aspects
      });
      return toCommandReply(formatJobReply(response));
    }
  };
}

export const jarvisWebToolNames = [...WEB_TOOL_NAMES];
export const jarvisWebCommandNames = [...WEB_COMMAND_NAMES];

export default definePluginEntry({
  id: "jarvis-web",
  name: "Jarvis Web Intelligence",
  description: "Web intelligence plugin for news search, profile scraping, page monitoring, contact enrichment, job tracking, and competitive intelligence",
  register(api) {
    api.registerTool((ctx) => createWebTools(ctx));
    api.registerCommand(createWebCommand());
    api.registerCommand(createIntelCommand());
  }
});
