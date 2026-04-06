import type { BrowserAdapter } from "@jarvis/browser-worker";
import type { SocialAdapter, ExecutionOutcome } from "./adapter.js";
import { SocialWorkerError } from "./adapter.js";
import type { PlatformHandler } from "./platform-handler.js";
import type {
  SocialPlatform,
  SocialLikeInput,
  SocialLikeOutput,
  SocialCommentInput,
  SocialCommentOutput,
  SocialRepostInput,
  SocialRepostOutput,
  SocialPostInput,
  SocialPostOutput,
  SocialFollowInput,
  SocialFollowOutput,
  SocialScanFeedInput,
  SocialScanFeedOutput,
  SocialDigestInput,
  SocialDigestOutput,
  DigestEntry,
} from "./types.js";

import { LinkedInHandler } from "./platforms/linkedin.js";
import { TwitterHandler } from "./platforms/twitter.js";
import { GitHubHandler } from "./platforms/github.js";
import { RedditHandler } from "./platforms/reddit.js";
import { FacebookHandler } from "./platforms/facebook.js";

function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const DEFAULT_RATE_LIMITS: Record<string, number> = {
  like: 15,
  comment: 5,
  repost: 3,
  post: 3,
  follow: 10,
};

export class BrowserSocialAdapter implements SocialAdapter {
  private readonly handlers: Map<SocialPlatform, PlatformHandler>;
  private readonly actionLog: DigestEntry[] = [];
  private readonly actionCounts = new Map<string, number>();
  private readonly limits: Record<string, number>;

  constructor(
    private readonly browser: BrowserAdapter,
    rateLimits?: Partial<Record<string, number>>,
  ) {
    this.handlers = new Map<SocialPlatform, PlatformHandler>([
      ["linkedin", new LinkedInHandler()],
      ["twitter", new TwitterHandler()],
      ["github", new GitHubHandler()],
      ["reddit", new RedditHandler()],
      ["facebook", new FacebookHandler()],
    ]);
    const merged: Record<string, number> = { ...DEFAULT_RATE_LIMITS };
    if (rateLimits) {
      for (const [key, value] of Object.entries(rateLimits)) {
        if (value !== undefined) {
          merged[key] = value;
        }
      }
    }
    this.limits = merged;
  }

  // ── Rate-limiting ─────────────────────────────────────────────────────────

  private checkRateLimit(platform: SocialPlatform, action: string): void {
    const key = `${platform}:${action}`;
    const current = this.actionCounts.get(key) ?? 0;
    const limit = this.limits[action] ?? 50;

    if (current >= limit) {
      throw new SocialWorkerError(
        "RATE_LIMITED",
        `Rate limit reached for ${action} on ${platform}: ${current}/${limit}`,
        true,
        { platform, action, current, limit },
      );
    }
  }

  private recordAction(platform: SocialPlatform, action: string): void {
    const key = `${platform}:${action}`;
    const current = this.actionCounts.get(key) ?? 0;
    this.actionCounts.set(key, current + 1);
  }

  private getHandler(platform: SocialPlatform): PlatformHandler {
    const handler = this.handlers.get(platform);
    if (!handler) {
      throw new SocialWorkerError(
        "UNSUPPORTED_PLATFORM",
        `Platform "${platform}" is not supported.`,
        false,
        { platform, supported: [...this.handlers.keys()] },
      );
    }
    return handler;
  }

  private logAction(
    platform: string,
    action: string,
    targetUrl: string,
    detail?: string,
  ): void {
    this.actionLog.push({
      platform,
      action,
      target_url: targetUrl,
      detail,
      timestamp: new Date().toISOString(),
    });
  }

  // ── like ──────────────────────────────────────────────────────────────────

  async like(input: SocialLikeInput): Promise<ExecutionOutcome<SocialLikeOutput>> {
    const handler = this.getHandler(input.platform);
    this.checkRateLimit(input.platform, "like");

    try {
      await handler.like(this.browser, input.post_url);
      this.recordAction(input.platform, "like");
      await randomDelay(3000, 5000);

      const timestamp = new Date().toISOString();
      this.logAction(input.platform, "like", input.post_url);

      return {
        summary: `Liked post on ${input.platform}: ${input.post_url}`,
        structured_output: {
          platform: input.platform,
          post_url: input.post_url,
          liked: true,
          timestamp,
        },
      };
    } catch (error) {
      if (error instanceof SocialWorkerError) throw error;

      const timestamp = new Date().toISOString();
      this.logAction(input.platform, "like_failed", input.post_url, String(error));

      return {
        summary: `Failed to like post on ${input.platform}: ${(error as Error).message}`,
        structured_output: {
          platform: input.platform,
          post_url: input.post_url,
          liked: false,
          timestamp,
        },
      };
    }
  }

  // ── comment ───────────────────────────────────────────────────────────────

  async comment(input: SocialCommentInput): Promise<ExecutionOutcome<SocialCommentOutput>> {
    const handler = this.getHandler(input.platform);
    this.checkRateLimit(input.platform, "comment");

    try {
      await handler.comment(this.browser, input.post_url, input.text);
      this.recordAction(input.platform, "comment");
      await randomDelay(3000, 5000);

      const timestamp = new Date().toISOString();
      this.logAction(input.platform, "comment", input.post_url, input.text.slice(0, 100));

      return {
        summary: `Commented on ${input.platform} post: ${input.post_url}`,
        structured_output: {
          platform: input.platform,
          post_url: input.post_url,
          commented: true,
          text: input.text,
          timestamp,
        },
      };
    } catch (error) {
      if (error instanceof SocialWorkerError) throw error;

      const timestamp = new Date().toISOString();
      this.logAction(input.platform, "comment_failed", input.post_url, String(error));

      return {
        summary: `Failed to comment on ${input.platform}: ${(error as Error).message}`,
        structured_output: {
          platform: input.platform,
          post_url: input.post_url,
          commented: false,
          text: input.text,
          timestamp,
        },
      };
    }
  }

  // ── repost ────────────────────────────────────────────────────────────────

  async repost(input: SocialRepostInput): Promise<ExecutionOutcome<SocialRepostOutput>> {
    const handler = this.getHandler(input.platform);
    this.checkRateLimit(input.platform, "repost");

    try {
      await handler.repost(this.browser, input.post_url, input.quote_text);
      this.recordAction(input.platform, "repost");
      await randomDelay(3000, 5000);

      const timestamp = new Date().toISOString();
      this.logAction(input.platform, "repost", input.post_url, input.quote_text);

      return {
        summary: `Reposted on ${input.platform}: ${input.post_url}`,
        structured_output: {
          platform: input.platform,
          post_url: input.post_url,
          reposted: true,
          timestamp,
        },
      };
    } catch (error) {
      if (error instanceof SocialWorkerError) throw error;

      const timestamp = new Date().toISOString();
      this.logAction(input.platform, "repost_failed", input.post_url, String(error));

      return {
        summary: `Failed to repost on ${input.platform}: ${(error as Error).message}`,
        structured_output: {
          platform: input.platform,
          post_url: input.post_url,
          reposted: false,
          timestamp,
        },
      };
    }
  }

  // ── post ──────────────────────────────────────────────────────────────────

  async post(input: SocialPostInput): Promise<ExecutionOutcome<SocialPostOutput>> {
    const handler = this.getHandler(input.platform);
    this.checkRateLimit(input.platform, "post");

    try {
      await handler.post(this.browser, input.text, input.media_path);
      this.recordAction(input.platform, "post");
      await randomDelay(3000, 5000);

      const timestamp = new Date().toISOString();
      this.logAction(input.platform, "post", input.platform, input.text.slice(0, 100));

      return {
        summary: `Posted on ${input.platform}: "${input.text.slice(0, 80)}..."`,
        structured_output: {
          platform: input.platform,
          posted: true,
          timestamp,
        },
      };
    } catch (error) {
      if (error instanceof SocialWorkerError) throw error;

      const timestamp = new Date().toISOString();
      this.logAction(input.platform, "post_failed", input.platform, String(error));

      return {
        summary: `Failed to post on ${input.platform}: ${(error as Error).message}`,
        structured_output: {
          platform: input.platform,
          posted: false,
          timestamp,
        },
      };
    }
  }

  // ── follow ────────────────────────────────────────────────────────────────

  async follow(input: SocialFollowInput): Promise<ExecutionOutcome<SocialFollowOutput>> {
    const handler = this.getHandler(input.platform);
    this.checkRateLimit(input.platform, "follow");

    try {
      await handler.follow(this.browser, input.profile_url);
      this.recordAction(input.platform, "follow");
      await randomDelay(3000, 5000);

      const timestamp = new Date().toISOString();
      this.logAction(input.platform, "follow", input.profile_url);

      return {
        summary: `Followed profile on ${input.platform}: ${input.profile_url}`,
        structured_output: {
          platform: input.platform,
          profile_url: input.profile_url,
          followed: true,
          timestamp,
        },
      };
    } catch (error) {
      if (error instanceof SocialWorkerError) throw error;

      const timestamp = new Date().toISOString();
      this.logAction(input.platform, "follow_failed", input.profile_url, String(error));

      return {
        summary: `Failed to follow on ${input.platform}: ${(error as Error).message}`,
        structured_output: {
          platform: input.platform,
          profile_url: input.profile_url,
          followed: false,
          timestamp,
        },
      };
    }
  }

  // ── scanFeed ──────────────────────────────────────────────────────────────

  async scanFeed(input: SocialScanFeedInput): Promise<ExecutionOutcome<SocialScanFeedOutput>> {
    const handler = this.getHandler(input.platform);

    try {
      const posts = await handler.scanFeed(this.browser, {
        max_posts: input.max_posts,
        filter_keywords: input.filter_keywords,
      });

      const scannedAt = new Date().toISOString();
      this.logAction(input.platform, "scan_feed", input.platform, `${posts.length} posts`);

      return {
        summary: `Scanned ${input.platform} feed: found ${posts.length} post(s).`,
        structured_output: {
          platform: input.platform,
          posts,
          scanned_at: scannedAt,
        },
      };
    } catch (error) {
      if (error instanceof SocialWorkerError) throw error;

      throw new SocialWorkerError(
        "SCAN_FAILED",
        `Failed to scan ${input.platform} feed: ${(error as Error).message}`,
        true,
        { platform: input.platform },
      );
    }
  }

  // ── digest ────────────────────────────────────────────────────────────────

  async digest(input: SocialDigestInput): Promise<ExecutionOutcome<SocialDigestOutput>> {
    const period = input.period ?? "session";
    const generatedAt = new Date().toISOString();

    // Summarize actions from the log
    const entries = [...this.actionLog];
    const totalActions = entries.length;

    // Build a summary from action counts
    const actionSummary = new Map<string, number>();
    for (const entry of entries) {
      const key = `${entry.platform}:${entry.action}`;
      actionSummary.set(key, (actionSummary.get(key) ?? 0) + 1);
    }

    const summaryParts: string[] = [];
    for (const [key, count] of actionSummary) {
      summaryParts.push(`${key}: ${count}`);
    }

    const summary = totalActions === 0
      ? "No social actions recorded in this period."
      : `${totalActions} action(s) recorded: ${summaryParts.join(", ")}`;

    return {
      summary,
      structured_output: {
        entries,
        summary,
        total_actions: totalActions,
        period,
        generated_at: generatedAt,
      },
    };
  }
}

export function createBrowserSocialAdapter(
  browser: BrowserAdapter,
  rateLimits?: Partial<Record<string, number>>,
): SocialAdapter {
  return new BrowserSocialAdapter(browser, rateLimits);
}
