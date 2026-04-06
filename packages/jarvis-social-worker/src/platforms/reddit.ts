import type { BrowserAdapter } from "@jarvis/browser-worker";
import type { FeedPost } from "../types.js";
import type { PlatformHandler, ScanOptions } from "../platform-handler.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const INTER_ACTION_DELAY_MS = 4000;

export class RedditHandler implements PlatformHandler {
  readonly platform = "reddit";

  // ── like (upvote) ─────────────────────────────────────────────────────────

  async like(browser: BrowserAdapter, postUrl: string): Promise<void> {
    await browser.navigate({ url: postUrl });
    await sleep(INTER_ACTION_DELAY_MS);

    const upvoteSelectors = [
      'button[aria-label="upvote"]',
      'button[aria-label="Upvote"]',
      'button.icon-upvote',
      'button[data-click-id="upvote"]',
      'div.voteButton button:first-child',
    ];

    let clicked = false;
    for (const selector of upvoteSelectors) {
      try {
        await browser.waitFor({ selector, timeout_ms: 5000, visible: true });
        await browser.click({ selector });
        clicked = true;
        break;
      } catch {
        // Try next selector
      }
    }

    if (!clicked) {
      console.warn(`[reddit] Could not find upvote button on ${postUrl}`);
      throw new Error(`Upvote button not found on ${postUrl}`);
    }

    await sleep(INTER_ACTION_DELAY_MS);
  }

  // ── comment ───────────────────────────────────────────────────────────────

  async comment(browser: BrowserAdapter, postUrl: string, text: string): Promise<void> {
    await browser.navigate({ url: postUrl });
    await sleep(INTER_ACTION_DELAY_MS);

    // Type in the comment field
    const commentSelectors = [
      'div[contenteditable="true"][data-lexical-editor]',
      'textarea[name="comment"]',
      'div[role="textbox"]',
      'div.public-DraftEditor-content',
      'shreddit-composer textarea',
    ];

    let typed = false;
    for (const selector of commentSelectors) {
      try {
        await browser.waitFor({ selector, timeout_ms: 5000, visible: true });
        await browser.click({ selector }); // Focus the editor
        await sleep(500);
        await browser.type({ selector, text, clear_first: true });
        typed = true;
        break;
      } catch {
        // Try next
      }
    }

    if (!typed) {
      console.warn(`[reddit] Could not find comment field on ${postUrl}`);
      throw new Error(`Comment field not found on ${postUrl}`);
    }

    await sleep(1000);

    // Submit the comment
    const submitSelectors = [
      'button[type="submit"][slot="submit-button"]',
      'button[data-testid="comment-submit-button"]',
      'button.c-btn-primary',
      'button[type="submit"]',
    ];

    let submitted = false;
    for (const selector of submitSelectors) {
      try {
        await browser.waitFor({ selector, timeout_ms: 3000, visible: true });
        await browser.click({ selector });
        submitted = true;
        break;
      } catch {
        // Try next
      }
    }

    if (!submitted) {
      console.warn(`[reddit] Could not find comment submit button on ${postUrl}`);
      throw new Error(`Comment submit button not found on ${postUrl}`);
    }

    await sleep(INTER_ACTION_DELAY_MS);
  }

  // ── repost (crosspost) ────────────────────────────────────────────────────

  async repost(browser: BrowserAdapter, postUrl: string, _quoteText?: string): Promise<void> {
    await browser.navigate({ url: postUrl });
    await sleep(INTER_ACTION_DELAY_MS);

    // Open the share/crosspost menu
    const shareSelectors = [
      'button[aria-label="share"]',
      'button[aria-label="Share"]',
      'button[data-click-id="share"]',
      'button.share-button',
    ];

    let clicked = false;
    for (const selector of shareSelectors) {
      try {
        await browser.waitFor({ selector, timeout_ms: 5000, visible: true });
        await browser.click({ selector });
        clicked = true;
        break;
      } catch {
        // Try next
      }
    }

    if (!clicked) {
      console.warn(`[reddit] Could not find share/crosspost button on ${postUrl}`);
      throw new Error(`Share button not found on ${postUrl}`);
    }

    await sleep(2000);

    // Click the crosspost option
    const crosspostSelectors = [
      'button[role="menuitem"]:has-text("Crosspost")',
      'a[href*="crosspost"]',
      'button:has-text("Crosspost")',
    ];

    for (const selector of crosspostSelectors) {
      try {
        await browser.waitFor({ selector, timeout_ms: 3000, visible: true });
        await browser.click({ selector });
        break;
      } catch {
        // Try next — crosspost may not always be available
      }
    }

    await sleep(INTER_ACTION_DELAY_MS);
  }

  // ── post ──────────────────────────────────────────────────────────────────

  async post(browser: BrowserAdapter, text: string, _mediaPath?: string): Promise<void> {
    // Parse subreddit from text if provided as "r/subreddit\n---\ntitle\n---\nbody"
    const parts = text.split("\n---\n");
    let subreddit: string;
    let title: string;
    let body: string;

    if (parts.length >= 3) {
      subreddit = parts[0]!.trim();
      title = parts[1]!.trim();
      body = parts.slice(2).join("\n---\n");
    } else {
      // Default: use first line as title, rest as body
      const lines = text.split("\n");
      title = lines[0] ?? "New Post";
      body = lines.slice(1).join("\n");
      subreddit = "r/test";
    }

    // Navigate to the submit page
    const submitUrl = `https://www.reddit.com/${subreddit}/submit`;
    await browser.navigate({ url: submitUrl });
    await sleep(INTER_ACTION_DELAY_MS);

    // Fill the title
    const titleSelectors = [
      'textarea[name="title"]',
      'input[name="title"]',
      'textarea[placeholder*="Title"]',
      'div[data-testid="post-title"] textarea',
    ];

    let titleFilled = false;
    for (const selector of titleSelectors) {
      try {
        await browser.waitFor({ selector, timeout_ms: 5000, visible: true });
        await browser.type({ selector, text: title, clear_first: true });
        titleFilled = true;
        break;
      } catch {
        // Try next
      }
    }

    if (!titleFilled) {
      console.warn("[reddit] Could not find post title field");
      throw new Error("Post title field not found");
    }

    await sleep(1000);

    // Fill the body
    const bodySelectors = [
      'div[contenteditable="true"][data-lexical-editor]',
      'textarea[name="text"]',
      'div[role="textbox"]',
      'div.public-DraftEditor-content',
    ];

    let bodyFilled = false;
    for (const selector of bodySelectors) {
      try {
        await browser.waitFor({ selector, timeout_ms: 5000, visible: true });
        await browser.type({ selector, text: body, clear_first: true });
        bodyFilled = true;
        break;
      } catch {
        // Try next
      }
    }

    if (!bodyFilled) {
      console.warn("[reddit] Could not find post body field");
      throw new Error("Post body field not found");
    }

    await sleep(1000);

    // Submit the post
    const submitSelectors = [
      'button[type="submit"]',
      'button[data-testid="post-submit-button"]',
      'button.c-btn-primary',
    ];

    let submitted = false;
    for (const selector of submitSelectors) {
      try {
        await browser.waitFor({ selector, timeout_ms: 3000, visible: true });
        await browser.click({ selector });
        submitted = true;
        break;
      } catch {
        // Try next
      }
    }

    if (!submitted) {
      console.warn("[reddit] Could not find Submit post button");
      throw new Error("Submit post button not found");
    }

    await sleep(INTER_ACTION_DELAY_MS);
  }

  // ── follow (join subreddit) ───────────────────────────────────────────────

  async follow(browser: BrowserAdapter, profileUrl: string): Promise<void> {
    await browser.navigate({ url: profileUrl });
    await sleep(INTER_ACTION_DELAY_MS);

    const joinSelectors = [
      'button[aria-label*="Join"]',
      'button:has-text("Join")',
      'button[data-testid="subreddit-join-button"]',
      'button.join-btn',
    ];

    let clicked = false;
    for (const selector of joinSelectors) {
      try {
        await browser.waitFor({ selector, timeout_ms: 5000, visible: true });
        await browser.click({ selector });
        clicked = true;
        break;
      } catch {
        // Try next
      }
    }

    if (!clicked) {
      console.warn(`[reddit] Could not find Join button on ${profileUrl}`);
      throw new Error(`Join button not found on ${profileUrl}`);
    }

    await sleep(INTER_ACTION_DELAY_MS);
  }

  // ── scanFeed ──────────────────────────────────────────────────────────────

  async scanFeed(browser: BrowserAdapter, options: ScanOptions): Promise<FeedPost[]> {
    const maxPosts = options.max_posts ?? 10;

    // If filter keywords look like subreddit names, navigate to those
    const url = "https://www.reddit.com/";
    await browser.navigate({ url });
    await sleep(INTER_ACTION_DELAY_MS);

    const extractResult = await browser.extract({
      selector: "article, .Post, shreddit-post",
      format: "text",
    });

    const content = extractResult.structured_output.content;
    return parseFeedContent(content, maxPosts, options.filter_keywords);
  }
}

function parseFeedContent(
  content: string,
  maxPosts: number,
  filterKeywords?: string[],
): FeedPost[] {
  const blocks = content.split(/\n{2,}/).filter((b) => b.trim().length > 10);
  const posts: FeedPost[] = [];

  for (const block of blocks) {
    if (posts.length >= maxPosts) break;

    if (filterKeywords && filterKeywords.length > 0) {
      const lower = block.toLowerCase();
      const matches = filterKeywords.some((kw) => lower.includes(kw.toLowerCase()));
      if (!matches) continue;
    }

    posts.push({
      post_url: "https://www.reddit.com/unknown",
      author: "Unknown",
      text_preview: block.slice(0, 200),
      likes: 0,
      comments: 0,
    });
  }

  return posts;
}
