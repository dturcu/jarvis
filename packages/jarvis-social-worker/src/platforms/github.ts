import type { BrowserAdapter } from "@jarvis/browser-worker";
import type { FeedPost } from "../types.js";
import type { PlatformHandler, ScanOptions } from "../platform-handler.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const INTER_ACTION_DELAY_MS = 3000;

export class GitHubHandler implements PlatformHandler {
  readonly platform = "github";

  // ── like (star) ───────────────────────────────────────────────────────────

  async like(browser: BrowserAdapter, postUrl: string): Promise<void> {
    await browser.navigate({ url: postUrl });
    await sleep(INTER_ACTION_DELAY_MS);

    const starSelectors = [
      '.starring-container button[aria-label*="Star"]',
      'button.js-toggler-target[aria-label*="Star"]',
      'form.unstarred button[type="submit"]',
      'button[data-ga-click*="star"]',
    ];

    let clicked = false;
    for (const selector of starSelectors) {
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
      console.warn(`[github] Could not find star button on ${postUrl}`);
      throw new Error(`Star button not found on ${postUrl}`);
    }

    await sleep(INTER_ACTION_DELAY_MS);
  }

  // ── comment ───────────────────────────────────────────────────────────────

  async comment(browser: BrowserAdapter, postUrl: string, text: string): Promise<void> {
    await browser.navigate({ url: postUrl });
    await sleep(INTER_ACTION_DELAY_MS);

    // Type in the comment field on an issue or PR
    const commentFieldSelectors = [
      "#new_comment_field",
      'textarea[name="comment[body]"]',
      "textarea.js-comment-field",
      "#issue_body",
    ];

    let typed = false;
    for (const selector of commentFieldSelectors) {
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
      console.warn(`[github] Could not find comment field on ${postUrl}`);
      throw new Error(`Comment field not found on ${postUrl}`);
    }

    await sleep(1000);

    // Submit the comment
    const submitSelectors = [
      'button[type="submit"].btn-primary',
      'button[data-disable-with="Comment"]',
      "button.js-comment-submit-button",
      'input[type="submit"][value="Comment"]',
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
      console.warn(`[github] Could not find Comment submit button on ${postUrl}`);
      throw new Error(`Comment submit button not found on ${postUrl}`);
    }

    await sleep(INTER_ACTION_DELAY_MS);
  }

  // ── repost (fork) ─────────────────────────────────────────────────────────

  async repost(browser: BrowserAdapter, postUrl: string, _quoteText?: string): Promise<void> {
    await browser.navigate({ url: postUrl });
    await sleep(INTER_ACTION_DELAY_MS);

    const forkSelectors = [
      'a[data-hydro-click*="fork"]',
      'button[data-hydro-click*="fork"]',
      'a.btn[href$="/fork"]',
      "a.social-count[href*='members']",
    ];

    let clicked = false;
    for (const selector of forkSelectors) {
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
      console.warn(`[github] Could not find Fork button on ${postUrl}`);
      throw new Error(`Fork button not found on ${postUrl}`);
    }

    await sleep(5000);

    // Confirm fork creation if a confirmation page appears
    const confirmSelectors = [
      'button[data-disable-with="Creating fork"]',
      'button.btn-primary[type="submit"]',
    ];

    for (const selector of confirmSelectors) {
      try {
        await browser.waitFor({ selector, timeout_ms: 3000, visible: true });
        await browser.click({ selector });
        break;
      } catch {
        // Confirmation may not always appear
      }
    }

    await sleep(INTER_ACTION_DELAY_MS);
  }

  // ── post (create issue) ───────────────────────────────────────────────────

  async post(browser: BrowserAdapter, text: string, _mediaPath?: string): Promise<void> {
    // The text should contain "REPO_URL\n---\nTITLE\n---\nBODY" or just be plain text
    // For simplicity, we parse the text for an optional title
    const parts = text.split("\n---\n");
    let repoUrl: string;
    let title: string;
    let body: string;

    if (parts.length >= 3) {
      repoUrl = parts[0]!.trim();
      title = parts[1]!.trim();
      body = parts.slice(2).join("\n---\n");
    } else {
      // Default: navigate to github.com and create an issue with title = first line
      const lines = text.split("\n");
      title = lines[0] ?? "New Issue";
      body = lines.slice(1).join("\n");
      repoUrl = "https://github.com";
    }

    // Navigate to the new issue page
    const issueUrl = repoUrl.endsWith("/issues/new")
      ? repoUrl
      : `${repoUrl.replace(/\/$/, "")}/issues/new`;

    await browser.navigate({ url: issueUrl });
    await sleep(INTER_ACTION_DELAY_MS);

    // Fill title
    const titleSelectors = [
      "#issue_title",
      'input[name="issue[title]"]',
      'input[placeholder*="Title"]',
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
      console.warn("[github] Could not find issue title field");
      throw new Error("Issue title field not found");
    }

    await sleep(1000);

    // Fill body
    const bodySelectors = [
      "#issue_body",
      'textarea[name="issue[body]"]',
      "textarea.js-comment-field",
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
      console.warn("[github] Could not find issue body field");
      throw new Error("Issue body field not found");
    }

    await sleep(1000);

    // Submit the issue
    const submitSelectors = [
      'button[data-disable-with*="Submitting"]',
      'button.btn-primary[type="submit"]',
      'button[data-disable-with="Submit new issue"]',
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
      console.warn("[github] Could not find Submit issue button");
      throw new Error("Submit issue button not found");
    }

    await sleep(INTER_ACTION_DELAY_MS);
  }

  // ── follow ────────────────────────────────────────────────────────────────

  async follow(browser: BrowserAdapter, profileUrl: string): Promise<void> {
    await browser.navigate({ url: profileUrl });
    await sleep(INTER_ACTION_DELAY_MS);

    const followSelectors = [
      'input[type="submit"][value="Follow"]',
      'button[aria-label="Follow"]',
      'form[action*="follow"] button[type="submit"]',
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
      console.warn(`[github] Could not find Follow button on ${profileUrl}`);
      throw new Error(`Follow button not found on ${profileUrl}`);
    }

    await sleep(INTER_ACTION_DELAY_MS);
  }

  // ── scanFeed ──────────────────────────────────────────────────────────────

  async scanFeed(browser: BrowserAdapter, options: ScanOptions): Promise<FeedPost[]> {
    const maxPosts = options.max_posts ?? 10;
    await browser.navigate({ url: "https://github.com" });
    await sleep(INTER_ACTION_DELAY_MS);

    const extractResult = await browser.extract({
      selector: ".dashboard-feed",
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
      post_url: "https://github.com",
      author: "Unknown",
      text_preview: block.slice(0, 200),
      likes: 0,
      comments: 0,
    });
  }

  return posts;
}
