export type SocialPlatform = "linkedin" | "twitter" | "github" | "reddit" | "facebook";

// ── social.like ──────────────────────────────────────────────────────────────

export type SocialLikeInput = {
  platform: SocialPlatform;
  post_url: string;
};

export type SocialLikeOutput = {
  platform: string;
  post_url: string;
  liked: boolean;
  timestamp: string;
};

// ── social.comment ───────────────────────────────────────────────────────────

export type SocialCommentInput = {
  platform: SocialPlatform;
  post_url: string;
  text: string;
};

export type SocialCommentOutput = {
  platform: string;
  post_url: string;
  commented: boolean;
  text: string;
  timestamp: string;
};

// ── social.repost ────────────────────────────────────────────────────────────

export type SocialRepostInput = {
  platform: SocialPlatform;
  post_url: string;
  quote_text?: string;
};

export type SocialRepostOutput = {
  platform: string;
  post_url: string;
  reposted: boolean;
  timestamp: string;
};

// ── social.post ──────────────────────────────────────────────────────────────

export type SocialPostInput = {
  platform: SocialPlatform;
  text: string;
  media_path?: string;
};

export type SocialPostOutput = {
  platform: string;
  posted: boolean;
  post_url?: string;
  timestamp: string;
};

// ── social.follow ────────────────────────────────────────────────────────────

export type SocialFollowInput = {
  platform: SocialPlatform;
  profile_url: string;
};

export type SocialFollowOutput = {
  platform: string;
  profile_url: string;
  followed: boolean;
  timestamp: string;
};

// ── social.scan_feed ─────────────────────────────────────────────────────────

export type SocialScanFeedInput = {
  platform: SocialPlatform;
  max_posts?: number;
  filter_keywords?: string[];
};

export type FeedPost = {
  post_url: string;
  author: string;
  text_preview: string;
  likes: number;
  comments: number;
  timestamp?: string;
};

export type SocialScanFeedOutput = {
  platform: string;
  posts: FeedPost[];
  scanned_at: string;
};

// ── social.digest ────────────────────────────────────────────────────────────

export type DigestEntry = {
  platform: string;
  action: string;
  target_url: string;
  detail?: string;
  timestamp: string;
};

export type SocialDigestInput = {
  period?: string;
};

export type SocialDigestOutput = {
  entries: DigestEntry[];
  summary: string;
  total_actions: number;
  period: string;
  generated_at: string;
};
