import type { BrowserAdapter } from "@jarvis/browser-worker";
import type { FeedPost } from "./types.js";

export type ScanOptions = {
  max_posts?: number;
  filter_keywords?: string[];
};

export interface PlatformHandler {
  readonly platform: string;
  like(browser: BrowserAdapter, postUrl: string): Promise<void>;
  comment(browser: BrowserAdapter, postUrl: string, text: string): Promise<void>;
  repost(browser: BrowserAdapter, postUrl: string, quoteText?: string): Promise<void>;
  post(browser: BrowserAdapter, text: string, mediaPath?: string): Promise<void>;
  follow(browser: BrowserAdapter, profileUrl: string): Promise<void>;
  scanFeed(browser: BrowserAdapter, options: ScanOptions): Promise<FeedPost[]>;
}
