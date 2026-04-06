import type { BrowserAdapter } from "@jarvis/browser-worker";
import type { FeedPost } from "../types.js";
import type { PlatformHandler, ScanOptions } from "../platform-handler.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const INTER_ACTION_DELAY_MS = 4000;

export class FacebookHandler implements PlatformHandler {
  readonly platform = "facebook";

  // ── like ──────────────────────────────────────────────────────────────────

  async like(browser: BrowserAdapter, postUrl: string): Promise<void> {
    await browser.navigate({ url: postUrl });
    await sleep(INTER_ACTION_DELAY_MS);

    const likeSelectors = [
      'div[aria-label="Like"]',
      'span[aria-label="Like"]',
      'button[aria-label="Like"]',
      'div[data-testid="like_button"]',
      'div[role="button"][aria-label*="Like"]',
    ];

    let clicked = false;
    for (const selector of likeSelectors) {
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
      console.warn(`[facebook] Could not find Like button on ${postUrl}`);
      throw new Error(`Like button not found on ${postUrl}`);
    }

    await sleep(INTER_ACTION_DELAY_MS);
  }

  // ── comment ───────────────────────────────────────────────────────────────

  async comment(browser: BrowserAdapter, postUrl: string, text: string): Promise<void> {
    await browser.navigate({ url: postUrl });
    await sleep(INTER_ACTION_DELAY_MS);

    // Click comment button to open the comment section
    const commentButtonSelectors = [
      'div[aria-label="Leave a comment"]',
      'div[aria-label="Comment"]',
      'span[data-testid="comment_link"]',
      'div[role="button"][aria-label*="Comment"]',
    ];

    for (const selector of commentButtonSelectors) {
      try {
        await browser.waitFor({ selector, timeout_ms: 5000, visible: true });
        await browser.click({ selector });
        break;
      } catch {
        // Try next
      }
    }

    await sleep(2000);

    // Type in the comment field
    const commentFieldSelectors = [
      'div[aria-label="Write a comment"]',
      'div[aria-label="Write a comment..."]',
      'div[contenteditable="true"][role="textbox"]',
      'div[data-testid="comment_composer_input"]',
    ];

    let typed = false;
    for (const selector of commentFieldSelectors) {
      try {
        await browser.waitFor({ selector, timeout_ms: 5000, visible: true });
        await browser.click({ selector }); // Focus
        await sleep(500);
        await browser.type({ selector, text, clear_first: true });
        typed = true;
        break;
      } catch {
        // Try next
      }
    }

    if (!typed) {
      console.warn(`[facebook] Could not find comment field on ${postUrl}`);
      throw new Error(`Comment field not found on ${postUrl}`);
    }

    await sleep(1000);

    // Submit with Enter key (Facebook comments submit on Enter)
    try {
      await browser.evaluate({ script: `
        const editor = document.querySelector('div[contenteditable="true"][role="textbox"]');
        if (editor) {
          const enterEvent = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true });
          editor.dispatchEvent(enterEvent);
        }
      ` });
    } catch {
      // Fallback: try to find a submit button
      const submitSelectors = [
        'button[aria-label="Comment"]',
        'div[aria-label="Comment"][role="button"]',
      ];

      for (const selector of submitSelectors) {
        try {
          await browser.waitFor({ selector, timeout_ms: 3000, visible: true });
          await browser.click({ selector });
          break;
        } catch {
          // Try next
        }
      }
    }

    await sleep(INTER_ACTION_DELAY_MS);
  }

  // ── repost (share) ────────────────────────────────────────────────────────

  async repost(browser: BrowserAdapter, postUrl: string, _quoteText?: string): Promise<void> {
    await browser.navigate({ url: postUrl });
    await sleep(INTER_ACTION_DELAY_MS);

    const shareSelectors = [
      'div[aria-label="Send this to friends or post it on your profile."]',
      'div[aria-label="Share"]',
      'span[data-testid="share_link"]',
      'div[role="button"][aria-label*="Share"]',
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
      console.warn(`[facebook] Could not find Share button on ${postUrl}`);
      throw new Error(`Share button not found on ${postUrl}`);
    }

    await sleep(2000);

    // Select "Share now" from the menu
    const shareNowSelectors = [
      'div[role="menuitem"]:first-child',
      'span:has-text("Share now")',
      'div[aria-label="Share now"]',
    ];

    for (const selector of shareNowSelectors) {
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
    await browser.navigate({ url: "https://www.facebook.com/" });
    await sleep(INTER_ACTION_DELAY_MS);

    // Click "What's on your mind?" to open the post creator
    const triggerSelectors = [
      'div[aria-label="Create a post"]',
      'div[role="button"][aria-label*="What\'s on your mind"]',
      'span:has-text("What\'s on your mind")',
      'div[data-testid="status-attachment-mentions-input"]',
    ];

    let opened = false;
    for (const selector of triggerSelectors) {
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
      console.warn("[facebook] Could not find create post trigger");
      throw new Error("Create post trigger not found");
    }

    await sleep(2000);

    // Type in the post editor
    const editorSelectors = [
      'div[aria-label="What\'s on your mind?"]',
      'div[contenteditable="true"][role="textbox"]',
      'div[data-testid="status-attachment-mentions-input"]',
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
      console.warn("[facebook] Could not find post editor");
      throw new Error("Post editor not found");
    }

    await sleep(1000);

    // Click the Post button
    const postButtonSelectors = [
      'div[aria-label="Post"][role="button"]',
      'button[data-testid="react-composer-post-button"]',
      'div[role="button"]:has-text("Post")',
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
      console.warn("[facebook] Could not find Post button");
      throw new Error("Post button not found");
    }

    await sleep(INTER_ACTION_DELAY_MS);
  }

  // ── follow ────────────────────────────────────────────────────────────────

  async follow(browser: BrowserAdapter, profileUrl: string): Promise<void> {
    await browser.navigate({ url: profileUrl });
    await sleep(INTER_ACTION_DELAY_MS);

    const followSelectors = [
      'div[aria-label="Follow"]',
      'div[role="button"][aria-label*="Follow"]',
      'div[aria-label="Add friend"]',
      'button[aria-label="Follow"]',
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
      console.warn(`[facebook] Could not find Follow/Add Friend button on ${profileUrl}`);
      throw new Error(`Follow button not found on ${profileUrl}`);
    }

    await sleep(INTER_ACTION_DELAY_MS);
  }

  // ── scanFeed ──────────────────────────────────────────────────────────────

  async scanFeed(browser: BrowserAdapter, options: ScanOptions): Promise<FeedPost[]> {
    const maxPosts = options.max_posts ?? 10;
    await browser.navigate({ url: "https://www.facebook.com/" });
    await sleep(INTER_ACTION_DELAY_MS);

    const extractResult = await browser.extract({
      selector: 'div[role="article"], div[data-testid="Keycommand_wrapper"]',
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
      post_url: "https://www.facebook.com/unknown",
      author: "Unknown",
      text_preview: block.slice(0, 200),
      likes: 0,
      comments: 0,
    });
  }

  return posts;
}
