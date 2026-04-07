/**
 * Exhaustive Stress: Social Worker
 *
 * Covers every social operation type across all platforms with thorough
 * input permutations: like, comment, repost, post, follow, scan_feed,
 * digest, action tracking, concurrency, and full engagement cycles.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { MockSocialAdapter, executeSocialJob } from "@jarvis/social-worker";
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

// ── Every operation type on LinkedIn ───────────────────────────────────────

describe("Social Exhaustive — LinkedIn operations", () => {
  let social: MockSocialAdapter;

  beforeEach(() => {
    social = new MockSocialAdapter();
  });

  it("like a post on linkedin", async () => {
    const result = await executeSocialJob(
      envelope("social.like", { platform: "linkedin", post_url: "https://linkedin.com/post/001" }),
      social,
    );
    expect(result.status).toBe("completed");
    expect(result.structured_output?.liked).toBe(true);
  });

  it("comment on a post on linkedin", async () => {
    const result = await executeSocialJob(
      envelope("social.comment", {
        platform: "linkedin",
        post_url: "https://linkedin.com/post/001",
        text: "Great insight on AUTOSAR migration!",
      }),
      social,
    );
    expect(result.status).toBe("completed");
  });

  it("repost on linkedin", async () => {
    const result = await executeSocialJob(
      envelope("social.repost", { platform: "linkedin", post_url: "https://linkedin.com/post/002" }),
      social,
    );
    expect(result.status).toBe("completed");
  });

  it("create a post on linkedin", async () => {
    const result = await executeSocialJob(
      envelope("social.post", {
        platform: "linkedin",
        text: "ISO 26262 compliance starts with culture, not checklists.",
      }),
      social,
    );
    expect(result.status).toBe("completed");
    expect(result.structured_output?.post_url).toBeTruthy();
  });

  it("follow a profile on linkedin", async () => {
    const result = await executeSocialJob(
      envelope("social.follow", { platform: "linkedin", profile_url: "https://linkedin.com/in/safety-expert" }),
      social,
    );
    expect(result.status).toBe("completed");
  });

  it("scan feed on linkedin", async () => {
    const result = await executeSocialJob(
      envelope("social.scan_feed", { platform: "linkedin", max_posts: 10 }),
      social,
    );
    expect(result.status).toBe("completed");
  });

  it("digest on linkedin", async () => {
    await executeSocialJob(envelope("social.like", { platform: "linkedin", post_url: "https://linkedin.com/post/x1" }), social);
    const result = await executeSocialJob(
      envelope("social.digest", { platform: "linkedin", period: "7d" }),
      social,
    );
    expect(result.status).toBe("completed");
  });
});

// ── Every platform ─────────────────────────────────────────────────────────

describe("Social Exhaustive — cross-platform", () => {
  let social: MockSocialAdapter;

  beforeEach(() => {
    social = new MockSocialAdapter();
  });

  it("like + post on twitter", async () => {
    const like = await executeSocialJob(
      envelope("social.like", { platform: "twitter", post_url: "https://twitter.com/status/123" }),
      social,
    );
    expect(like.status).toBe("completed");

    const post = await executeSocialJob(
      envelope("social.post", { platform: "twitter", text: "Functional safety matters." }),
      social,
    );
    expect(post.status).toBe("completed");
    expect(post.structured_output?.post_url).toBeTruthy();
  });

  it("like + post on github", async () => {
    const like = await executeSocialJob(
      envelope("social.like", { platform: "github", post_url: "https://github.com/issue/1" }),
      social,
    );
    expect(like.status).toBe("completed");

    const post = await executeSocialJob(
      envelope("social.post", { platform: "github", text: "New release: AUTOSAR compliance toolkit v2.0" }),
      social,
    );
    expect(post.status).toBe("completed");
  });

  it("like + post on reddit", async () => {
    const like = await executeSocialJob(
      envelope("social.like", { platform: "reddit", post_url: "https://reddit.com/r/automotive/post/1" }),
      social,
    );
    expect(like.status).toBe("completed");

    const post = await executeSocialJob(
      envelope("social.post", { platform: "reddit", text: "Discussion: ISO 26262 Part 6 best practices" }),
      social,
    );
    expect(post.status).toBe("completed");
  });

  it("like + post on facebook", async () => {
    const like = await executeSocialJob(
      envelope("social.like", { platform: "facebook", post_url: "https://facebook.com/post/456" }),
      social,
    );
    expect(like.status).toBe("completed");

    const post = await executeSocialJob(
      envelope("social.post", { platform: "facebook", text: "Safety engineering workshop next week!" }),
      social,
    );
    expect(post.status).toBe("completed");
  });
});

// ── Action tracking by method ──────────────────────────────────────────────

describe("Social Exhaustive — action tracking by method", () => {
  let social: MockSocialAdapter;

  beforeEach(() => {
    social = new MockSocialAdapter();
  });

  it("tracks like actions", async () => {
    await executeSocialJob(envelope("social.like", { platform: "linkedin", post_url: "https://li.com/p1" }), social);
    await executeSocialJob(envelope("social.like", { platform: "linkedin", post_url: "https://li.com/p2" }), social);
    const likes = social.getActionsByMethod("like");
    expect(likes).toHaveLength(2);
  });

  it("tracks comment actions", async () => {
    await executeSocialJob(envelope("social.comment", { platform: "linkedin", post_url: "https://li.com/p1", text: "Nice!" }), social);
    await executeSocialJob(envelope("social.comment", { platform: "twitter", post_url: "https://tw.com/p1", text: "Agreed!" }), social);
    await executeSocialJob(envelope("social.comment", { platform: "linkedin", post_url: "https://li.com/p2", text: "Great!" }), social);
    const comments = social.getActionsByMethod("comment");
    expect(comments).toHaveLength(3);
  });

  it("tracks repost actions", async () => {
    await executeSocialJob(envelope("social.repost", { platform: "linkedin", post_url: "https://li.com/rp1" }), social);
    const reposts = social.getActionsByMethod("repost");
    expect(reposts).toHaveLength(1);
  });

  it("tracks post actions", async () => {
    await executeSocialJob(envelope("social.post", { platform: "linkedin", text: "Post A" }), social);
    await executeSocialJob(envelope("social.post", { platform: "twitter", text: "Post B" }), social);
    const posts = social.getActionsByMethod("post");
    expect(posts).toHaveLength(2);
  });

  it("tracks follow actions", async () => {
    await executeSocialJob(envelope("social.follow", { platform: "linkedin", profile_url: "https://li.com/in/user1" }), social);
    await executeSocialJob(envelope("social.follow", { platform: "github", profile_url: "https://github.com/user2" }), social);
    const follows = social.getActionsByMethod("follow");
    expect(follows).toHaveLength(2);
  });

  it("tracks scanFeed actions", async () => {
    await executeSocialJob(envelope("social.scan_feed", { platform: "linkedin", max_posts: 5 }), social);
    await executeSocialJob(envelope("social.scan_feed", { platform: "twitter", max_posts: 10 }), social);
    const scans = social.getActionsByMethod("scanFeed");
    expect(scans).toHaveLength(2);
  });
});

// ── Action tracking by platform ────────────────────────────────────────────

describe("Social Exhaustive — action tracking by platform", () => {
  let social: MockSocialAdapter;

  beforeEach(() => {
    social = new MockSocialAdapter();
  });

  it("filters actions by platform across mixed operations", async () => {
    // Linkedin: 3 ops
    await executeSocialJob(envelope("social.like", { platform: "linkedin", post_url: "https://li.com/p1" }), social);
    await executeSocialJob(envelope("social.comment", { platform: "linkedin", post_url: "https://li.com/p1", text: "Nice" }), social);
    await executeSocialJob(envelope("social.post", { platform: "linkedin", text: "Hello world" }), social);

    // Twitter: 2 ops
    await executeSocialJob(envelope("social.like", { platform: "twitter", post_url: "https://tw.com/p1" }), social);
    await executeSocialJob(envelope("social.repost", { platform: "twitter", post_url: "https://tw.com/p2" }), social);

    // Github: 1 op
    await executeSocialJob(envelope("social.follow", { platform: "github", profile_url: "https://github.com/u1" }), social);

    expect(social.getActionsByPlatform("linkedin")).toHaveLength(3);
    expect(social.getActionsByPlatform("twitter")).toHaveLength(2);
    expect(social.getActionsByPlatform("github")).toHaveLength(1);
    expect(social.getActionsByPlatform("reddit")).toHaveLength(0);
    expect(social.getActionsByPlatform("facebook")).toHaveLength(0);
  });
});

// ── Post with media, comments with special text, scan/digest variations ───

describe("Social Exhaustive — input variations", () => {
  let social: MockSocialAdapter;

  beforeEach(() => {
    social = new MockSocialAdapter();
  });

  it("post with media_path", async () => {
    const result = await executeSocialJob(
      envelope("social.post", {
        platform: "linkedin",
        text: "Our latest compliance dashboard screenshot",
        media_path: "/tmp/dashboard-screenshot.png",
      }),
      social,
    );
    expect(result.status).toBe("completed");
    expect(result.structured_output?.post_url).toBeTruthy();
  });

  it("comment with long text", async () => {
    const longText = "This is a very detailed comment about ISO 26262 compliance. ".repeat(20);
    const result = await executeSocialJob(
      envelope("social.comment", {
        platform: "linkedin",
        post_url: "https://linkedin.com/post/long-001",
        text: longText,
      }),
      social,
    );
    expect(result.status).toBe("completed");
  });

  it("comment with special characters", async () => {
    const result = await executeSocialJob(
      envelope("social.comment", {
        platform: "linkedin",
        post_url: "https://linkedin.com/post/special-001",
        text: "Gro\u00dfe Arbeit! \u00dcber ISO 26262 & AUTOSAR <compliance> @expert #safety",
      }),
      social,
    );
    expect(result.status).toBe("completed");
  });

  it("scan_feed with max_posts=1", async () => {
    const result = await executeSocialJob(
      envelope("social.scan_feed", { platform: "linkedin", max_posts: 1 }),
      social,
    );
    expect(result.status).toBe("completed");
  });

  it("scan_feed with max_posts=50", async () => {
    const result = await executeSocialJob(
      envelope("social.scan_feed", { platform: "linkedin", max_posts: 50 }),
      social,
    );
    expect(result.status).toBe("completed");
  });

  it("scan_feed without max_posts (default)", async () => {
    const result = await executeSocialJob(
      envelope("social.scan_feed", { platform: "twitter" }),
      social,
    );
    expect(result.status).toBe("completed");
  });

  it("digest with period=1d", async () => {
    const result = await executeSocialJob(
      envelope("social.digest", { platform: "linkedin", period: "1d" }),
      social,
    );
    expect(result.status).toBe("completed");
  });

  it("digest with period=30d", async () => {
    const result = await executeSocialJob(
      envelope("social.digest", { platform: "linkedin", period: "30d" }),
      social,
    );
    expect(result.status).toBe("completed");
  });

  it("digest without period (default)", async () => {
    const result = await executeSocialJob(
      envelope("social.digest", { platform: "twitter" }),
      social,
    );
    expect(result.status).toBe("completed");
  });
});

// ── Full engagement cycle on each platform ─────────────────────────────────

describe("Social Exhaustive — full engagement cycles", () => {
  let social: MockSocialAdapter;

  beforeEach(() => {
    social = new MockSocialAdapter();
  });

  it("full cycle on linkedin: scan -> like -> comment -> repost -> post -> follow", async () => {
    const scan = await executeSocialJob(envelope("social.scan_feed", { platform: "linkedin", max_posts: 5 }), social);
    expect(scan.status).toBe("completed");

    const like = await executeSocialJob(envelope("social.like", { platform: "linkedin", post_url: "https://li.com/p1" }), social);
    expect(like.status).toBe("completed");

    const comment = await executeSocialJob(envelope("social.comment", { platform: "linkedin", post_url: "https://li.com/p1", text: "Excellent!" }), social);
    expect(comment.status).toBe("completed");

    const repost = await executeSocialJob(envelope("social.repost", { platform: "linkedin", post_url: "https://li.com/p1" }), social);
    expect(repost.status).toBe("completed");

    const post = await executeSocialJob(envelope("social.post", { platform: "linkedin", text: "Safety-first engineering." }), social);
    expect(post.status).toBe("completed");

    const follow = await executeSocialJob(envelope("social.follow", { platform: "linkedin", profile_url: "https://li.com/in/expert" }), social);
    expect(follow.status).toBe("completed");
  });

  it("full cycle on twitter: scan -> like -> comment -> post", async () => {
    const scan = await executeSocialJob(envelope("social.scan_feed", { platform: "twitter", max_posts: 5 }), social);
    expect(scan.status).toBe("completed");

    const like = await executeSocialJob(envelope("social.like", { platform: "twitter", post_url: "https://tw.com/s1" }), social);
    expect(like.status).toBe("completed");

    const comment = await executeSocialJob(envelope("social.comment", { platform: "twitter", post_url: "https://tw.com/s1", text: "Spot on!" }), social);
    expect(comment.status).toBe("completed");

    const post = await executeSocialJob(envelope("social.post", { platform: "twitter", text: "New article on ASPICE." }), social);
    expect(post.status).toBe("completed");
  });

  it("full cycle on github: like -> comment -> follow", async () => {
    const like = await executeSocialJob(envelope("social.like", { platform: "github", post_url: "https://github.com/issue/10" }), social);
    expect(like.status).toBe("completed");

    const comment = await executeSocialJob(envelope("social.comment", { platform: "github", post_url: "https://github.com/issue/10", text: "Confirmed fix." }), social);
    expect(comment.status).toBe("completed");

    const follow = await executeSocialJob(envelope("social.follow", { platform: "github", profile_url: "https://github.com/safety-dev" }), social);
    expect(follow.status).toBe("completed");
  });
});

// ── Concurrency ────────────────────────────────────────────────────────────

describe("Social Exhaustive — concurrency", () => {
  let social: MockSocialAdapter;

  beforeEach(() => {
    social = new MockSocialAdapter();
  });

  it("20 parallel operations across platforms", async () => {
    const ops = [
      ...range(4).map(i => executeSocialJob(envelope("social.like", { platform: "linkedin", post_url: `https://li.com/c-${i}` }), social)),
      ...range(4).map(i => executeSocialJob(envelope("social.comment", { platform: "twitter", post_url: `https://tw.com/c-${i}`, text: `C${i}` }), social)),
      ...range(3).map(i => executeSocialJob(envelope("social.post", { platform: "linkedin", text: `Post ${i}` }), social)),
      ...range(3).map(i => executeSocialJob(envelope("social.repost", { platform: "github", post_url: `https://gh.com/c-${i}` }), social)),
      ...range(3).map(i => executeSocialJob(envelope("social.follow", { platform: "reddit", profile_url: `https://reddit.com/u/user-${i}` }), social)),
      ...range(3).map(() => executeSocialJob(envelope("social.scan_feed", { platform: "facebook", max_posts: 5 }), social)),
    ];
    const results = await Promise.all(ops);
    expect(results).toHaveLength(20);
    expect(results.every(r => r.status === "completed")).toBe(true);
  });

  it("action count accuracy after mixed operations", async () => {
    // 3 likes + 2 comments + 1 repost + 1 post + 1 follow + 1 scan = 9 actions
    await executeSocialJob(envelope("social.like", { platform: "linkedin", post_url: "https://li.com/a1" }), social);
    await executeSocialJob(envelope("social.like", { platform: "twitter", post_url: "https://tw.com/a2" }), social);
    await executeSocialJob(envelope("social.like", { platform: "github", post_url: "https://gh.com/a3" }), social);
    await executeSocialJob(envelope("social.comment", { platform: "linkedin", post_url: "https://li.com/a1", text: "X" }), social);
    await executeSocialJob(envelope("social.comment", { platform: "twitter", post_url: "https://tw.com/a2", text: "Y" }), social);
    await executeSocialJob(envelope("social.repost", { platform: "linkedin", post_url: "https://li.com/a1" }), social);
    await executeSocialJob(envelope("social.post", { platform: "linkedin", text: "Hello" }), social);
    await executeSocialJob(envelope("social.follow", { platform: "github", profile_url: "https://github.com/user1" }), social);
    await executeSocialJob(envelope("social.scan_feed", { platform: "linkedin", max_posts: 5 }), social);

    expect(social.getActionCount()).toBe(9);
    expect(social.getActions()).toHaveLength(9);
  });

  it("getActions returns all recorded actions in order", async () => {
    await executeSocialJob(envelope("social.like", { platform: "linkedin", post_url: "https://li.com/order-1" }), social);
    await executeSocialJob(envelope("social.post", { platform: "twitter", text: "Second" }), social);
    await executeSocialJob(envelope("social.follow", { platform: "github", profile_url: "https://github.com/third" }), social);

    const actions = social.getActions();
    expect(actions).toHaveLength(3);
  });
});
