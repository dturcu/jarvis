import type { SocialAdapter, ExecutionOutcome } from "./adapter.js";
import { SocialWorkerError } from "./adapter.js";
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
  FeedPost,
  DigestEntry,
} from "./types.js";

const MOCK_NOW = "2026-04-05T12:00:00.000Z";

const SUPPORTED_PLATFORMS: SocialPlatform[] = [
  "linkedin",
  "twitter",
  "github",
  "reddit",
  "facebook",
];

export type MockSocialAction = {
  method: string;
  input: unknown;
  timestamp: string;
};

const MOCK_FEED_POSTS: Record<SocialPlatform, FeedPost[]> = {
  linkedin: [
    {
      post_url: "https://www.linkedin.com/feed/update/urn:li:activity:1234",
      author: "Jan Krause",
      text_preview: "Excited to share our latest AUTOSAR migration success story...",
      likes: 42,
      comments: 8,
      timestamp: "2026-04-04T10:00:00.000Z",
    },
    {
      post_url: "https://www.linkedin.com/feed/update/urn:li:activity:5678",
      author: "Maria Schmidt",
      text_preview: "ISO 26262 compliance is not just a checkbox exercise...",
      likes: 128,
      comments: 23,
      timestamp: "2026-04-04T08:30:00.000Z",
    },
    {
      post_url: "https://www.linkedin.com/feed/update/urn:li:activity:9012",
      author: "Automotive Safety Summit",
      text_preview: "Join us for the annual SOTIF workshop in Munich this June...",
      likes: 67,
      comments: 12,
      timestamp: "2026-04-03T14:00:00.000Z",
    },
  ],
  twitter: [
    {
      post_url: "https://x.com/user/status/12345",
      author: "@autosafety_news",
      text_preview: "Breaking: New UNECE regulation on automated driving published today.",
      likes: 89,
      comments: 15,
      timestamp: "2026-04-04T11:00:00.000Z",
    },
    {
      post_url: "https://x.com/user/status/67890",
      author: "@iso26262_expert",
      text_preview: "ASIL decomposition explained in one thread:",
      likes: 234,
      comments: 45,
      timestamp: "2026-04-04T09:15:00.000Z",
    },
  ],
  github: [
    {
      post_url: "https://github.com/autosar/adaptive-platform/issues/42",
      author: "autosar-contributor",
      text_preview: "Feature request: Add support for ARXML 4.5 schema validation",
      likes: 12,
      comments: 5,
      timestamp: "2026-04-03T16:00:00.000Z",
    },
  ],
  reddit: [
    {
      post_url: "https://www.reddit.com/r/embedded/comments/abc123",
      author: "u/embedded_dev",
      text_preview: "What tools do you use for ISO 26262 compliance in embedded projects?",
      likes: 156,
      comments: 67,
      timestamp: "2026-04-04T07:00:00.000Z",
    },
  ],
  facebook: [
    {
      post_url: "https://www.facebook.com/autosafety/posts/11111",
      author: "Automotive Safety Group",
      text_preview: "Our Q2 functional safety meetup is confirmed for May 15th.",
      likes: 34,
      comments: 9,
      timestamp: "2026-04-03T12:00:00.000Z",
    },
  ],
};

export class MockSocialAdapter implements SocialAdapter {
  private readonly actions: MockSocialAction[] = [];
  private readonly digestLog: DigestEntry[] = [];
  private readonly mockNow: string;
  private postCounter = 0;

  constructor(options: { now?: string } = {}) {
    this.mockNow = options.now ?? MOCK_NOW;
  }

  // ── Inspection helpers ──────────────────────────────────────────────────────

  getActions(): ReadonlyArray<MockSocialAction> {
    return [...this.actions];
  }

  getActionCount(): number {
    return this.actions.length;
  }

  getActionsByMethod(method: string): MockSocialAction[] {
    return this.actions.filter((a) => a.method === method);
  }

  getActionsByPlatform(platform: SocialPlatform): MockSocialAction[] {
    return this.actions.filter((a) => {
      const input = a.input as Record<string, unknown>;
      return input.platform === platform;
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private record(method: string, input: unknown): void {
    this.actions.push({ method, input, timestamp: this.mockNow });
  }

  private validatePlatform(platform: string): asserts platform is SocialPlatform {
    if (!SUPPORTED_PLATFORMS.includes(platform as SocialPlatform)) {
      throw new SocialWorkerError(
        "UNSUPPORTED_PLATFORM",
        `Platform "${platform}" is not supported.`,
        false,
        { platform, supported: SUPPORTED_PLATFORMS },
      );
    }
  }

  private addDigestEntry(
    platform: string,
    action: string,
    targetUrl: string,
    detail?: string,
  ): void {
    this.digestLog.push({
      platform,
      action,
      target_url: targetUrl,
      detail,
      timestamp: this.mockNow,
    });
  }

  // ── like ──────────────────────────────────────────────────────────────────

  async like(input: SocialLikeInput): Promise<ExecutionOutcome<SocialLikeOutput>> {
    this.validatePlatform(input.platform);
    this.record("like", input);
    this.addDigestEntry(input.platform, "like", input.post_url);

    return {
      summary: `Liked post on ${input.platform}: ${input.post_url}`,
      structured_output: {
        platform: input.platform,
        post_url: input.post_url,
        liked: true,
        timestamp: this.mockNow,
      },
    };
  }

  // ── comment ───────────────────────────────────────────────────────────────

  async comment(input: SocialCommentInput): Promise<ExecutionOutcome<SocialCommentOutput>> {
    this.validatePlatform(input.platform);
    this.record("comment", input);
    this.addDigestEntry(input.platform, "comment", input.post_url, input.text.slice(0, 100));

    return {
      summary: `Commented on ${input.platform} post: ${input.post_url}`,
      structured_output: {
        platform: input.platform,
        post_url: input.post_url,
        commented: true,
        text: input.text,
        timestamp: this.mockNow,
      },
    };
  }

  // ── repost ────────────────────────────────────────────────────────────────

  async repost(input: SocialRepostInput): Promise<ExecutionOutcome<SocialRepostOutput>> {
    this.validatePlatform(input.platform);
    this.record("repost", input);
    this.addDigestEntry(input.platform, "repost", input.post_url, input.quote_text);

    return {
      summary: `Reposted on ${input.platform}: ${input.post_url}`,
      structured_output: {
        platform: input.platform,
        post_url: input.post_url,
        reposted: true,
        timestamp: this.mockNow,
      },
    };
  }

  // ── post ──────────────────────────────────────────────────────────────────

  async post(input: SocialPostInput): Promise<ExecutionOutcome<SocialPostOutput>> {
    this.validatePlatform(input.platform);
    this.record("post", input);

    this.postCounter += 1;
    const postUrl = `https://${input.platform}.com/mock-post-${this.postCounter}`;
    this.addDigestEntry(input.platform, "post", postUrl, input.text.slice(0, 100));

    return {
      summary: `Posted on ${input.platform}: "${input.text.slice(0, 80)}..."`,
      structured_output: {
        platform: input.platform,
        posted: true,
        post_url: postUrl,
        timestamp: this.mockNow,
      },
    };
  }

  // ── follow ────────────────────────────────────────────────────────────────

  async follow(input: SocialFollowInput): Promise<ExecutionOutcome<SocialFollowOutput>> {
    this.validatePlatform(input.platform);
    this.record("follow", input);
    this.addDigestEntry(input.platform, "follow", input.profile_url);

    return {
      summary: `Followed profile on ${input.platform}: ${input.profile_url}`,
      structured_output: {
        platform: input.platform,
        profile_url: input.profile_url,
        followed: true,
        timestamp: this.mockNow,
      },
    };
  }

  // ── scanFeed ──────────────────────────────────────────────────────────────

  async scanFeed(input: SocialScanFeedInput): Promise<ExecutionOutcome<SocialScanFeedOutput>> {
    this.validatePlatform(input.platform);
    this.record("scanFeed", input);

    const maxPosts = input.max_posts ?? 10;
    let posts = MOCK_FEED_POSTS[input.platform] ?? [];

    // Apply keyword filter
    if (input.filter_keywords && input.filter_keywords.length > 0) {
      posts = posts.filter((p) => {
        const text = p.text_preview.toLowerCase();
        return input.filter_keywords!.some((kw) => text.includes(kw.toLowerCase()));
      });
    }

    posts = posts.slice(0, maxPosts);

    return {
      summary: `Scanned ${input.platform} feed: found ${posts.length} post(s).`,
      structured_output: {
        platform: input.platform,
        posts,
        scanned_at: this.mockNow,
      },
    };
  }

  // ── digest ────────────────────────────────────────────────────────────────

  async digest(input: SocialDigestInput): Promise<ExecutionOutcome<SocialDigestOutput>> {
    const period = input.period ?? "session";
    const entries = [...this.digestLog];
    const totalActions = entries.length;

    const actionSummary = new Map<string, number>();
    for (const entry of entries) {
      const key = `${entry.platform}:${entry.action}`;
      actionSummary.set(key, (actionSummary.get(key) ?? 0) + 1);
    }

    const summaryParts: string[] = [];
    for (const [key, count] of actionSummary) {
      summaryParts.push(`${key}: ${count}`);
    }

    const summary =
      totalActions === 0
        ? "No social actions recorded in this period."
        : `${totalActions} action(s) recorded: ${summaryParts.join(", ")}`;

    return {
      summary,
      structured_output: {
        entries,
        summary,
        total_actions: totalActions,
        period,
        generated_at: this.mockNow,
      },
    };
  }
}

export function createMockSocialAdapter(
  options: { now?: string } = {},
): SocialAdapter {
  return new MockSocialAdapter(options);
}
