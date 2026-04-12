import type { PlanStep } from "@jarvis/agent-framework";
import { JOB_TYPE_NAMES, type JarvisJobType } from "@jarvis/shared";

const ACTION_ALIASES: Record<string, JarvisJobType> = {
  "api.call": "inference.chat",
  "collection.health": "inference.chat",
  "collection.health_check": "inference.chat",
  "database.query": "inference.chat",
  "device.notification": "device.notify",
  "device.type": "device.type_text",
  "inference.entity_resolve": "inference.chat",
  "inference.entity_resolution": "inference.chat",
  "inference.query": "inference.chat",
  "inference.query_approval_records": "inference.chat",
  "inference.query_decision_logs": "inference.chat",
  "inference.query_knowledge_collection": "inference.chat",
  "inference.resolve": "inference.chat",
  "synthesis": "inference.chat",
  "synthesize": "inference.chat",
  "synthesis.generate_review_report": "inference.chat",
  "telegram.send": "device.notify",
  "telegram.send_notification": "device.notify",
} as const;

type NormalizedAction = {
  action: JarvisJobType;
  originalAction: string;
};

type Message = {
  role: "system" | "user" | "assistant";
  content: string;
};

function getPrefix(action: string): string {
  return action.split(".")[0] ?? action;
}

export function getAvailableJobTypes(capabilities: string[]): JarvisJobType[] {
  const allowedPrefixes = new Set(capabilities.map((capability) => getPrefix(capability).toLowerCase()));

  return JOB_TYPE_NAMES.filter((jobType) => allowedPrefixes.has(getPrefix(jobType)));
}

export function formatAvailableJobTypes(capabilities: string[]): string {
  const grouped = new Map<string, JarvisJobType[]>();

  for (const jobType of getAvailableJobTypes(capabilities)) {
    const prefix = getPrefix(jobType);
    const entries = grouped.get(prefix) ?? [];
    entries.push(jobType);
    grouped.set(prefix, entries);
  }

  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([prefix, jobTypes]) => `- ${prefix}: ${jobTypes.join(", ")}`)
    .join("\n");
}

function normalizeAction(action: string, allowedJobTypes: ReadonlySet<string>): NormalizedAction | null {
  if (allowedJobTypes.has(action)) {
    return { action: action as JarvisJobType, originalAction: action };
  }

  const alias = ACTION_ALIASES[action];
  if (alias && allowedJobTypes.has(alias)) {
    return { action: alias, originalAction: action };
  }

  if (action.startsWith("inference.") && allowedJobTypes.has("inference.chat")) {
    return { action: "inference.chat", originalAction: action };
  }

  return null;
}

function buildChatMessages(step: Pick<PlanStep, "action" | "input" | "reasoning">, originalAction: string): Message[] {
  const input = typeof step.input === "object" && step.input !== null
    ? { ...(step.input as Record<string, unknown>) }
    : {};

  const existingMessages = Array.isArray(input.messages)
    ? input.messages
        .map((message) => {
          if (typeof message !== "object" || message === null) return null;
          const role = (message as Record<string, unknown>).role;
          const content = (message as Record<string, unknown>).content;
          if ((role === "system" || role === "user" || role === "assistant") && typeof content === "string" && content.trim()) {
            return { role, content };
          }
          return null;
        })
        .filter((message): message is Message => message !== null)
    : [];

  if (existingMessages.length > 0) {
    return existingMessages;
  }

  const prompt = typeof input.prompt === "string" && input.prompt.trim()
    ? input.prompt.trim()
    : typeof input.query === "string" && input.query.trim()
      ? input.query.trim()
      : typeof input.text === "string" && input.text.trim()
        ? input.text.trim()
        : typeof input.content === "string" && input.content.trim()
          ? input.content.trim()
          : null;

  const rest = { ...input };
  delete rest.messages;
  delete rest.prompt;

  const parts: string[] = [];
  if (originalAction !== "inference.chat") {
    parts.push(`Perform the action "${originalAction}".`);
  }
  if (step.reasoning?.trim()) {
    parts.push(`Reasoning: ${step.reasoning.trim()}`);
  }
  if (prompt) {
    parts.push(`Task: ${prompt}`);
  }
  if (Object.keys(rest).length > 0) {
    parts.push(`Structured input:\n${JSON.stringify(rest, null, 2)}`);
  }

  const content = parts.join("\n\n") || `Perform the requested task for action "${originalAction}".`;
  return [{ role: "user", content }];
}

function normalizeInput(
  action: JarvisJobType,
  step: Pick<PlanStep, "action" | "input" | "reasoning">,
  originalAction: string,
): Record<string, unknown> | null {
  const input = typeof step.input === "object" && step.input !== null
    ? { ...(step.input as Record<string, unknown>) }
    : {};

  if (action === "document.ingest") {
    const filePath = typeof input.file_path === "string" && input.file_path.trim()
      ? input.file_path.trim()
      : null;
    if (!filePath) {
      return null;
    }
    input.file_path = filePath;
  }

  if (action === "web.search_news") {
    if (typeof input.q === "string" && typeof input.query !== "string") {
      input.query = input.q;
      delete input.q;
    }

    if (typeof input.query !== "string" || !input.query.trim()) {
      const derivedQuery = typeof input.prompt === "string" && input.prompt.trim()
        ? input.prompt.trim()
        : typeof input.text === "string" && input.text.trim()
          ? input.text.trim()
          : typeof input.content === "string" && input.content.trim()
            ? input.content.trim()
            : step.reasoning?.trim() || null;

      if (!derivedQuery) {
        return null;
      }

      input.query = derivedQuery;
    }
  }

  if (action === "device.notify") {
    const title = typeof input.title === "string" && input.title.trim()
      ? input.title.trim()
      : "Jarvis";
    const body = typeof input.body === "string" && input.body.trim()
      ? input.body.trim()
      : typeof input.message === "string" && input.message.trim()
        ? input.message.trim()
        : typeof input.content === "string" && input.content.trim()
          ? input.content.trim()
          : step.reasoning?.trim() || `Notification for ${originalAction}`;

    input.title = title;
    input.body = body;
    delete input.message;
  }

  if (action === "inference.chat") {
    input.messages = buildChatMessages(step, originalAction);
  }

  return input;
}

export function normalizePlannedStep(
  step: Pick<PlanStep, "step" | "action" | "input" | "reasoning">,
  capabilities: string[],
): PlanStep | null {
  const availableJobTypes = getAvailableJobTypes(capabilities);
  const normalizedAction = normalizeAction(step.action, new Set(availableJobTypes));
  if (!normalizedAction) return null;

  const normalizedInput = normalizeInput(normalizedAction.action, step, normalizedAction.originalAction);
  if (!normalizedInput) return null;

  return {
    step: step.step,
    action: normalizedAction.action,
    input: normalizedInput,
    reasoning: step.reasoning ?? "",
  };
}
