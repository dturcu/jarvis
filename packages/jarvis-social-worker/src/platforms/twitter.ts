import type { BrowserAdapter } from "@jarvis/browser-worker";
import type { FeedPost } from "../types.js";
import type { PlatformHandler, ScanOptions } from "../platform-handler.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const INTER_ACTION_DELAY_MS = 3000;

export class TwitterHandler implements PlatformHandler {
  readonly platform = "twitter";

  // ── like ──────────────────────────────────────────────────────────────────

  async like(browser: BrowserAdapter, postUrl: string): Promise<void> {
    await browser.navigate({ url: postUrl });
    await sleep(INTER_ACTION_DELAY_MS);

    const selectors = [
      'button[data-testid="like"]',
      'button[aria-label*="Like"]',
      'div[data-testid="like"] button',
    ];

    let clicked = false;
    for (const selector of selectors) {
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
      console.warn(`[twitter] Could not find like button on ${postUrl}`);
      throw new Error(`Like button not found on ${postUrl}`);
    }

    await sleep(INTER_ACTION_DELAY_MS);
  }

  // ── comment ───────────────────────────────────────────────────────────────

  async comment(browser: BrowserAdapter, postUrl: string, text: string): Promise<void> {
    await browser.navigate({ url: postUrl });
    await sleep(INTER_ACTION_DELAY_MS);

    // Click the reply button
    const replyButtonSelectors = [
      'button[data-testid="reply"]',
      'button[aria-label*="Reply"]',
      'div[data-testid="reply"] button',
    ];

    let opened = false;
    for (const selector of replyButtonSelectors) {
      try {
        await browser.waitFor({ selector, timeout_ms: 5000, visible: true });
        await browser.click({ selector });
        opened = true;
        break;
      } catch {
        // Try next
      }
    }

    if (!opened) {
      console.warn(`[twitter] Could not find reply button on ${postUrl}`);
      throw new Error(`Reply button not found on ${postUrl}`);
    }

    await sleep(2000);

    // Type in the reply editor
    const editorSelectors = [
      'div[data-testid="tweetTextarea_0"]',
      'div[role="textbox"][contenteditable="true"]',
      'div.public-DraftEditor-content',
    ];

    let typed = false;
    for (const selector of editorSelectors) {
      try {
        await browser.waitFor({ selector, timeout_ms: 5000, visible: true });
        await browser.type({ selector, text, clear_first: true });
        typed = true;
        break;
      } catch {
        // Try next
      }
    }

    if (!typed) {
      console.warn(`[twitter] Could not find reply editor on ${postUrl}`);
      throw new Error(`Reply editor not found on ${postUrl}`);
    }

    await sleep(1000);

    // Submit the reply
    const submitSelectors = [
      'button[data-testid="tweetButtonInline"]',
      'button[data-testid="tweetButton"]',
      'button[aria-label="Reply"]',
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
      console.warn(`[twitter] Could not find submit button for reply on ${postUrl}`);
      throw new Error(`Reply submit button not found on ${postUrl}`);
    }

    await sleep(INTER_ACTION_DELAY_MS);
  }

  // ── repost ────────────────────────────────────────────────────────────────

  async repost(browser: BrowserAdapter, postUrl: string, _quoteText?: string): Promise<void> {
    await browser.navigate({ url: postUrl });
    await sleep(INTER_ACTION_DELAY_MS);

    const retweetSelectors = [
      'button[data-testid="retweet"]',
      'button[aria-label*="Repost"]',
      'button[aria-label*="Retweet"]',
    ];

    let clicked = false;
    for (const selector of retweetSelectors) {
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
      console.warn(`[twitter] Could not find repost button on ${postUrl}`);
      throw new Error(`Repost button not found on ${postUrl}`);
    }

    await sleep(2000);

    // Confirm the repost from the menu
    const confirmSelectors = [
      'div[data-testid="retweetConfirm"]',
      'div[role="menuitem"][data-testid="retweetConfirm"]',
      'a[role="menuitem"]:first-child',
    ];

    for (const selector of confirmSelectors) {
      try {
        await browser.waitFor({ selector, timeout_ms: 3000, visible: true });
        await browser.click({ selector });
        break;
      } catch {
        // Try next
      }
    }

    await sleep(INTER_ACTION_DELAY_MS);
  }

  // ── post ──────────────────────────────────────────────────────────────────

  async post(browser: BrowserAdapter, text: string, _mediaPath?: string): Promise<void> {
    await browser.navigate({ url: "https://x.com/compose/post" });
    await sleep(INTER_ACTION_DELAY_MS);

    // Type in the compose editor
    const editorSelectors = [
      'div[data-testid="tweetTextarea_0"]',
      'div[role="textbox"][contenteditable="true"]',
      'div.public-DraftEditor-content',
    ];

    let typed = false;
    for (const selector of editorSelectors) {
      try {
        await browser.waitFor({ selector, timeout_ms: 5000, visible: true });
        await browser.type({ selector, text, clear_first: true });
        typed = true;
        break;
      } catch {
        // Try next
      }
    }

    if (!typed) {
      // Fallback: try clicking the compose button on the home page
      await browser.navigate({ url: "https://x.com/home" });
      await sleep(INTER_ACTION_DELAY_MS);

      const composeSelectors = [
        'a[data-testid="SideNav_NewTweet_Button"]',
        'a[href="/compose/post"]',
        'button[aria-label*="Post"]',
      ];

      for (const selector of composeSelectors) {
        try {
          await browser.waitFor({ selector, timeout_ms: 3000, visible: true });
          await browser.click({ selector });
          break;
        } catch {
          // Try next
        }
      }

      await sleep(2000);

      // Retry typing
      for (const selector of editorSelectors) {
        try {
          await browser.waitFor({ selector, timeout_ms: 5000, visible: true });
          await browser.type({ selector, text, clear_first: true });
          typed = true;
          break;
        } catch {
          // Try next
        }
      }

      if (!typed) {
        console.warn("[twitter] Could not find post editor");
        throw new Error("Post editor not found");
      }
    }

    await sleep(1000);

    // Click Post button
    const postButtonSelectors = [
      'button[data-testid="tweetButtonInline"]',
      'button[data-testid="tweetButton"]',
      'button[aria-label="Post"]',
    ];

    let posted = false;
    for (const selector of postButtonSelectors) {
      try {
        await browser.waitFor({ selector, timeout_ms: 3000, visible: true });
        await browser.click({ selector });
        posted = true;
        break;
      } catch {
        // Try next
      }
    }

    if (!posted) {
      console.warn("[twitter] Could not find Post button");
      throw new Error("Post button not found");
    }

    await sleep(INTER_ACTION_DELAY_MS);
  }

  // ── follow ────────────────────────────────────────────────────────────────

  async follow(browser: BrowserAdapter, profileUrl: string): Promise<void> {
    await browser.navigate({ url: profileUrl });
    await sleep(INTER_ACTION_DELAY_MS);

    const followSelectors = [
      'button[data-testid$="-follow"]',
      'button[aria-label*="Follow"]',
      'div[data-testid="placementTracking"] button',
    ];

    let clicked = false;
    for (const selector of followSelectors) {
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
      console.warn(`[twitter] Could not find Follow button on ${profileUrl}`);
      throw new Error(`Follow button not found on ${profileUrl}`);
    }

    await sleep(INTER_ACTION_DELAY_MS);
  }

  // ── scanFeed ──────────────────────────────────────────────────────────────

  async scanFeed(browser: BrowserAdapter, options: ScanOptions): Promise<FeedPost[]> {
    const maxPosts = options.max_posts ?? 10;
    await browser.navigate({ url: "https://x.com/home" });
    await sleep(INTER_ACTION_DELAY_MS);

    const extractResult = await browser.extract({
      selector: 'article[data-testid="tweet"]',
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
      post_url: "https://x.com/unknown/status/unknown",
      author: "Unknown",
      text_preview: block.slice(0, 280),
      likes: 0,
      comments: 0,
    });
  }

  return posts;
}
