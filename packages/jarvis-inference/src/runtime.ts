import http from "node:http";
import https from "node:https";

// ---------------------------------------------------------------------------
// Shared HTTP helper — replaces fetch() for Node.js 24 compatibility
// (undici pre-buffers SSE responses, breaking streaming; http.request avoids that)
// ---------------------------------------------------------------------------
function httpRequest(
  method: string,
  url: string,
  body?: string,
  timeoutMs?: number,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === "https:";
    const transport = isHttps ? https : http;
    let res: http.IncomingMessage | null = null;
    const req = transport.request(
      {
        hostname: parsed.hostname,
        port: Number(parsed.port) || (isHttps ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method,
        headers: body
          ? {
              "Content-Type": "application/json",
              "Content-Length": Buffer.byteLength(body),
            }
          : undefined,
      },
      (incomingRes) => {
        res = incomingRes;
        let data = "";
        res.on("data", (chunk: Buffer) => (data += chunk.toString()));
        res.on("end", () =>
          resolve({ status: res!.statusCode ?? 500, body: data }),
        );
        res.on("error", reject);
      },
    );
    if (timeoutMs) {
      setTimeout(() => {
        if (res) res.destroy();
        req.destroy(new Error("timeout"));
      }, timeoutMs);
    }
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type LlmRuntime = {
  name: "ollama" | "lmstudio" | "llamacpp";
  baseUrl: string;
  available: boolean;
};

const OLLAMA_DEFAULT_URL = "http://localhost:11434";
const LMSTUDIO_DEFAULT_URL = "http://localhost:1234";
export const LLAMACPP_DEFAULT_URL = "http://localhost:8080";
const PROBE_TIMEOUT_MS = 3000;

// ---------------------------------------------------------------------------
// Runtime detection
// ---------------------------------------------------------------------------
async function probeUrl(url: string, timeoutMs?: number): Promise<boolean> {
  try {
    const response = await httpRequest("GET", url, undefined, timeoutMs);
    return response.status >= 200 && response.status < 400;
  } catch {
    return false;
  }
}

export async function detectRuntimes(): Promise<LlmRuntime[]> {
  const [ollamaAvailable, lmstudioAvailable, llamacppAvailable] = await Promise.all([
    probeUrl(`${OLLAMA_DEFAULT_URL}/api/tags`, PROBE_TIMEOUT_MS),
    probeUrl(`${LMSTUDIO_DEFAULT_URL}/v1/models`, PROBE_TIMEOUT_MS),
    probeUrl(`${LLAMACPP_DEFAULT_URL}/health`, PROBE_TIMEOUT_MS),
  ]);

  return [
    { name: "ollama", baseUrl: OLLAMA_DEFAULT_URL, available: ollamaAvailable },
    {
      name: "lmstudio",
      baseUrl: LMSTUDIO_DEFAULT_URL,
      available: lmstudioAvailable,
    },
    {
      name: "llamacpp",
      baseUrl: LLAMACPP_DEFAULT_URL,
      available: llamacppAvailable,
    },
  ];
}

// ---------------------------------------------------------------------------
// Chat completion (non-streaming)
// ---------------------------------------------------------------------------
export type ChatCompletionParams = {
  baseUrl: string;
  model: string;
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  maxTokens?: number;
};

export type ChatCompletionResult = {
  content: string;
  model: string;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
  };
};

export async function chatCompletion(
  params: ChatCompletionParams,
): Promise<ChatCompletionResult> {
  const reqBody = JSON.stringify({
    model: params.model,
    messages: params.messages,
    temperature: params.temperature ?? 0.7,
    max_tokens: params.maxTokens,
    stream: false,
  });

  const response = await httpRequest(
    "POST",
    `${params.baseUrl}/v1/chat/completions`,
    reqBody,
  );

  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      `Chat completion failed (status ${response.status}): ${response.body.slice(0, 200)}`,
    );
  }

  const data = JSON.parse(response.body) as {
    choices?: Array<{ message?: { content?: string } }>;
    model?: string;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  const content = data.choices?.[0]?.message?.content ?? "";
  const model = data.model ?? params.model;
  const usage = {
    prompt_tokens: data.usage?.prompt_tokens ?? 0,
    completion_tokens: data.usage?.completion_tokens ?? 0,
  };

  return { content, model, usage };
}

// ---------------------------------------------------------------------------
// Embeddings
// ---------------------------------------------------------------------------
export type EmbedParams = {
  baseUrl: string;
  model: string;
  texts: string[];
};

export type EmbedResult = {
  embeddings: number[][];
};

export async function embedTexts(params: EmbedParams): Promise<EmbedResult> {
  const reqBody = JSON.stringify({
    model: params.model,
    input: params.texts,
  });

  const response = await httpRequest(
    "POST",
    `${params.baseUrl}/v1/embeddings`,
    reqBody,
  );

  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      `Embedding request failed (status ${response.status}): ${response.body.slice(0, 200)}`,
    );
  }

  const data = JSON.parse(response.body) as {
    data?: Array<{ embedding?: number[] }>;
  };

  const embeddings = (data.data ?? []).map((item) => item.embedding ?? []);
  return { embeddings };
}

// ---------------------------------------------------------------------------
// List models
// ---------------------------------------------------------------------------
export async function listModels(baseUrl: string): Promise<string[]> {
  let response: { status: number; body: string };
  try {
    response = await httpRequest("GET", `${baseUrl}/v1/models`);
  } catch {
    return [];
  }

  if (response.status < 200 || response.status >= 300) {
    return [];
  }

  let data: {
    data?: Array<{ id?: string }>;
    models?: Array<{ name?: string }>;
  };
  try {
    data = JSON.parse(response.body);
  } catch {
    return [];
  }

  if (data.data) {
    return data.data.map((m) => m.id ?? "").filter(Boolean);
  }
  if (data.models) {
    return data.models.map((m) => m.name ?? "").filter(Boolean);
  }
  return [];
}
