import http from "http";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type StreamChunk =
  | { type: "content"; text: string }
  | { type: "thinking"; text: string }
  | { type: "done" }
  | { type: "error"; message: string };

export type StreamChatParams = {
  baseUrl: string;
  model: string;
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  maxTokens?: number;
};

// ---------------------------------------------------------------------------
// Streaming chat via http.request + SSE parsing
// Uses the proven pattern from jarvis-dashboard/src/api/chat.ts
// ---------------------------------------------------------------------------
export async function* streamChat(
  params: StreamChatParams,
): AsyncGenerator<StreamChunk> {
  const url = new URL(`${params.baseUrl}/v1/chat/completions`);
  const body = JSON.stringify({
    model: params.model,
    messages: params.messages,
    stream: true,
    temperature: params.temperature ?? 0.7,
    max_tokens: params.maxTokens,
  });

  // We yield from inside the http callback, so bridge via an async queue
  const queue: StreamChunk[] = [];
  let done = false;
  let doneSent = false;
  let resolveWait: (() => void) | null = null;

  function push(chunk: StreamChunk): void {
    queue.push(chunk);
    if (resolveWait) {
      resolveWait();
      resolveWait = null;
    }
  }

  function waitForChunk(): Promise<void> {
    if (queue.length > 0 || done) return Promise.resolve();
    return new Promise<void>((resolve) => {
      resolveWait = resolve;
    });
  }

  const req = http.request(
    {
      hostname: url.hostname,
      port: Number(url.port) || 80,
      path: url.pathname + url.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    },
    (res) => {
      if ((res.statusCode ?? 500) >= 400) {
        let errBody = "";
        res.on("data", (c: Buffer) => (errBody += c.toString()));
        res.on("end", () => {
          push({
            type: "error",
            message: `LLM error ${res.statusCode}: ${errBody.slice(0, 200)}`,
          });
          done = true;
          if (resolveWait) resolveWait();
        });
        return;
      }

      let buffer = "";

      res.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") {
            if (!doneSent) {
              doneSent = true;
              push({ type: "done" });
            }
            continue;
          }
          try {
            const parsed = JSON.parse(data) as {
              choices?: Array<{
                delta?: { content?: string; reasoning_content?: string };
              }>;
            };
            const delta = parsed.choices?.[0]?.delta;
            if (delta?.reasoning_content) {
              push({ type: "thinking", text: delta.reasoning_content });
            }
            if (delta?.content) {
              push({ type: "content", text: delta.content });
            }
          } catch {
            /* skip malformed SSE data */
          }
        }
      });

      res.on("end", () => {
        // Ensure we always yield a done even if the server didn't send [DONE]
        if (!doneSent) {
          doneSent = true;
          push({ type: "done" });
        }
        done = true;
        if (resolveWait) resolveWait();
      });

      res.on("error", (e: Error) => {
        push({ type: "error", message: e.message });
        done = true;
        if (resolveWait) resolveWait();
      });
    },
  );

  req.on("error", (e: Error) => {
    push({ type: "error", message: `Cannot reach LLM: ${e.message}` });
    done = true;
    if (resolveWait) resolveWait();
  });

  req.write(body);
  req.end();

  // Drain the queue as an async generator
  while (true) {
    await waitForChunk();
    while (queue.length > 0) {
      const chunk = queue.shift()!;
      yield chunk;
      if (chunk.type === "done" || chunk.type === "error") return;
    }
    if (done) return;
  }
}
