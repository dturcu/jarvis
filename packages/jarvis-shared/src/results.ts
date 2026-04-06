import { CONTRACT_VERSION } from "./contracts.js";
import type { ToolResponse } from "./types.js";

export type JarvisToolResult<TDetails extends ToolResponse> = {
  content: Array<{
    type: "text";
    text: string;
  }>;
  details: TDetails;
};

export type JarvisCommandReply = {
  text: string;
  isError?: boolean;
};

export function createToolResponse(
  partial: Omit<ToolResponse, "contract_version">,
): ToolResponse {
  return {
    contract_version: CONTRACT_VERSION,
    ...partial
  };
}

export function toToolResult<TDetails extends ToolResponse>(
  details: TDetails,
): JarvisToolResult<TDetails> {
  return {
    content: [
      {
        type: "text",
        text: details.summary
      }
    ],
    details
  };
}

export function toCommandReply(
  text: string,
  isError = false,
): JarvisCommandReply {
  return {
    text,
    isError
  };
}

export function safeJsonParse<T>(value: string | undefined): T | null {
  if (!value?.trim()) {
    return null;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export function formatJobReply(response: ToolResponse): string {
  const parts = [response.summary];
  if (response.job_id) {
    parts.push(`job=${response.job_id}`);
  }
  if (response.approval_id) {
    parts.push(`approval=${response.approval_id}`);
  }
  return parts.join(" | ");
}

export function invalidJsonReply(commandName: string): JarvisCommandReply {
  return toCommandReply(`Invalid JSON arguments for /${commandName}.`, true);
}
