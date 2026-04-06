import type {
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
  SocialDigestOutput
} from "./types.js";

export type ExecutionOutcome<T> = {
  summary: string;
  structured_output: T;
};

export class SocialWorkerError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    retryable = false,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "SocialWorkerError";
    this.code = code;
    this.retryable = retryable;
    this.details = details;
  }
}

export interface SocialAdapter {
  like(input: SocialLikeInput): Promise<ExecutionOutcome<SocialLikeOutput>>;
  comment(input: SocialCommentInput): Promise<ExecutionOutcome<SocialCommentOutput>>;
  repost(input: SocialRepostInput): Promise<ExecutionOutcome<SocialRepostOutput>>;
  post(input: SocialPostInput): Promise<ExecutionOutcome<SocialPostOutput>>;
  follow(input: SocialFollowInput): Promise<ExecutionOutcome<SocialFollowOutput>>;
  scanFeed(input: SocialScanFeedInput): Promise<ExecutionOutcome<SocialScanFeedOutput>>;
  digest(input: SocialDigestInput): Promise<ExecutionOutcome<SocialDigestOutput>>;
}
