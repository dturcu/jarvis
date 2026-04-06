import type { BrowserAdapter } from "@jarvis/browser-worker";
import type { FeedPost } from "../types.js";
import type { PlatformHandler, ScanOptions } from "../platform-handler.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const INTER_ACTION_DELAY_MS = 3000;

export class LinkedInHandler implements PlatformHandler {
  readonly platform = "linkedin";

  // ── like ──────────────────────────────────────────────────────────────────

  async like(browser: BrowserAdapter, postUrl: string): Promise<void> {
    await browser.navigate({ url: postUrl });
    await sleep(INTER_ACTION_DELAY_MS);

    // LinkedIn uses multiple possible selectors for the like button
    const selectors = [
      'button[aria-label*="Like"]',
      'button[aria-label*="like"]',
      'button.react-button__trigger',
      'button[data-control-name="like_toggle"]',
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
      console.warn(`[linkedin] Could not find like button on ${postUrl} — tried ${selectors.length} selectors`);
      throw new Error(`Like button not found on ${postUrl}`);
    }

    await sleep(INTER_ACTION_DELAY_MS);
  }

  // ── comment ───────────────────────────────────────────────────────────────

  async comment(browser: BrowserAdapter, postUrl: string, text: string): Promise<void> {
    await browser.navigate({ url: postUrl });
    await sleep(INTER_ACTION_DELAY_MS);

    // Open comment section
    const commentButtonSelectors = [
      'button[aria-label*="Comment"]',
      'button[aria-label*="comment"]',
      'button.comment-button',
    ];

    let opened = false;
    for (const selector of commentButtonSelectors) {
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
      console.warn(`[linkedin] Could not find comment button on ${postUrl}`);
      throw new Error(`Comment button not found on ${postUrl}`);
    }

    await sleep(2000);

    // Type in the comment editor
    const editorSelectors = [
      ".comments-comment-texteditor .ql-editor",
      '.comments-comment-box__form .ql-editor',
      'div[role="textbox"][contenteditable="true"]',
      ".editor-content div[contenteditable]",
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
      console.warn(`[linkedin] Could not find comment editor on ${postUrl}`);
      throw new Error(`Comment editor not found on ${postUrl}`);
    }

    await sleep(1000);

    // Submit the comment
    const submitSelectors = [
      'button.comments-comment-box__submit-button',
      'button[aria-label*="Post comment"]',
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
      console.warn(`[linkedin] Could not find submit button for comment on ${postUrl}`);
      throw new Error(`Comment submit button not found on ${postUrl}`);
    }

    await sleep(INTER_ACTION_DELAY_MS);
  }

  // ── repost ────────────────────────────────────────────────────────────────

  async repost(browser: BrowserAdapter, postUrl: string, _quoteText?: string): Promise<void> {
    await browser.navigate({ url: postUrl });
    await sleep(INTER_ACTION_DELAY_MS);

    const repostButtonSelectors = [
      'button[aria-label*="Repost"]',
      'button[aria-label*="repost"]',
      'button[aria-label*="Share"]',
    ];

    let clicked = false;
    for (const selector of repostButtonSelectors) {
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
      console.warn(`[linkedin] Could not find repost button on ${postUrl}`);
      throw new Error(`Repost button not found on ${postUrl}`);
    }

    await sleep(2000);

    // Select "Repost" from the dropdown (instant repost)
    const repostOptionSelectors = [
      'button[data-control-name="repost"]',
      'div[role="menuitem"]:first-child',
      'li.social-reshare-option:first-child button',
    ];

    for (const selector of repostOptionSelectors) {
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
    await browser.navigate({ url: "https://www.linkedin.com/feed/" });
    await sleep(INTER_ACTION_DELAY_MS);

    // Open the post creation modal
    const startPostSelectors = [
      'button.share-box-feed-entry__trigger',
      'button[aria-label*="Start a post"]',
      'button[aria-label*="start a post"]',
      'div.share-box-feed-entry__top-bar button',
    ];

    let opened = false;
    for (const selector of startPostSelectors) {
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
      console.warn("[linkedin] Could not find 'Start a post' button");
      throw new Error("Start a post button not found");
    }

    await sleep(2000);

    // Type in the post editor
    const editorSelectors = [
      'div.ql-editor[data-placeholder]',
      'div[role="textbox"][contenteditable="true"]',
      ".share-creation-state__text-editor .ql-editor",
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
      console.warn("[linkedin] Could not find post editor");
      throw new Error("Post editor not found");
    }

    await sleep(1000);

    // Click the Post button
    const postButtonSelectors = [
      'button.share-actions__primary-action',
      'button[aria-label="Post"]',
      'button[data-control-name="share.post"]',
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
      console.warn("[linkedin] Could not find Post button");
      throw new Error("Post button not found");
    }

    await sleep(INTER_ACTION_DELAY_MS);
  }

  // ── follow ────────────────────────────────────────────────────────────────

  async follow(browser: BrowserAdapter, profileUrl: string): Promise<void> {
    await browser.navigate({ url: profileUrl });
    await sleep(INTER_ACTION_DELAY_MS);

    const followSelectors = [
      'button[aria-label*="Connect"]',
      'button[aria-label*="Follow"]',
      'button[aria-label*="follow"]',
      'button.pvs-profile-actions__action[aria-label*="Connect"]',
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
      console.warn(`[linkedin] Could not find Connect/Follow button on ${profileUrl}`);
      throw new Error(`Follow/Connect button not found on ${profileUrl}`);
    }

    await sleep(INTER_ACTION_DELAY_MS);
  }

  // ── scanFeed ──────────────────────────────────────────────────────────────

  async scanFeed(browser: BrowserAdapter, options: ScanOptions): Promise<FeedPost[]> {
    const maxPosts = options.max_posts ?? 10;
    await browser.navigate({ url: "https://www.linkedin.com/feed/" });
    await sleep(INTER_ACTION_DELAY_MS);

    // Extract posts from the feed
    const extractResult = await browser.extract({
      selector: ".feed-shared-update-v2",
      format: "text",
    });

    const content = extractResult.structured_output.content;
    const posts = parseFeedContent(content, maxPosts, options.filter_keywords);

    return posts;
  }
}

function parseFeedContent(
  content: string,
  maxPosts: number,
  filterKeywords?: string[],
): FeedPost[] {
  // Split content into rough post blocks by common delimiters
  const blocks = content.split(/\n{2,}/).filter((b) => b.trim().length > 20);

  const posts: FeedPost[] = [];

  for (const block of blocks) {
    if (posts.length >= maxPosts) break;

    // Apply keyword filter if specified
    if (filterKeywords && filterKeywords.length > 0) {
      const lower = block.toLowerCase();
      const matches = filterKeywords.some((kw) => lower.includes(kw.toLowerCase()));
      if (!matches) continue;
    }

    posts.push({
      post_url: "https://www.linkedin.com/feed/update/unknown",
      author: "Unknown Author",
      text_preview: block.slice(0, 200),
      likes: 0,
      comments: 0,
    });
  }

  return posts;
}
