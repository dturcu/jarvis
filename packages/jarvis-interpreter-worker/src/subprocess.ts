import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import type { InterpreterRunCodeOutput, InterpreterRunTaskOutput, InterpreterStep } from "./types.js";

export type InterpreterSession = {
  session_id: string;
  output: InterpreterRunTaskOutput;
};

export type CodeResult = {
  exit_code: number;
  stdout: string;
  stderr: string;
  execution_time_ms: number;
};

/**
 * Spawns the `interpreter` CLI process with --auto_run flag and captures
 * structured output from stdout. Returns a resolved session once the process exits.
 */
export async function spawnInterpreter(
  task: string,
  options: { model?: string; autoRun?: boolean },
): Promise<InterpreterSession> {
  return new Promise((resolve, reject) => {
    const sessionId = randomUUID();
    const args = ["--auto_run", "--json", "-p", task];
    if (options.model) {
      args.push("--model", options.model);
    }

    const steps: InterpreterStep[] = [];
    let stdoutBuffer = "";
    let stderrBuffer = "";
    const startedAt = Date.now();

    const proc = spawn("interpreter", args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
      shell: false
    });

    proc.stdout.on("data", (chunk: Buffer) => {
      stdoutBuffer += chunk.toString();
      // Parse newline-delimited JSON steps from the process output
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed) as Record<string, unknown>;
          if (parsed.type === "code" || parsed.type === "output" || parsed.type === "error") {
            steps.push({
              type: parsed.type as InterpreterStep["type"],
              language: typeof parsed.language === "string" ? parsed.language : undefined,
              content: typeof parsed.content === "string" ? parsed.content : String(parsed.content ?? "")
            });
          }
        } catch {
          // Non-JSON line treated as plain output
          steps.push({ type: "output", content: trimmed });
        }
      }
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      stderrBuffer += chunk.toString();
    });

    proc.on("error", (err) => {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new Error("Open Interpreter is not installed. Run: pip install open-interpreter"));
      } else {
        reject(err);
      }
    });

    proc.on("close", (_code) => {
      // Flush remaining buffer
      if (stdoutBuffer.trim()) {
        steps.push({ type: "output", content: stdoutBuffer.trim() });
      }
      if (stderrBuffer.trim()) {
        steps.push({ type: "error", content: stderrBuffer.trim() });
      }

      const outputSteps = steps.filter((s) => s.type === "output");
      const finalOutput = outputSteps.map((s) => s.content).join("\n").trim() || undefined;
      const elapsedMs = Date.now() - startedAt;

      resolve({
        session_id: sessionId,
        output: {
          session_id: sessionId,
          steps,
          final_output: finalOutput,
          artifacts: []
        }
      });

      void elapsedMs;
    });
  });
}

/**
 * Executes code via child_process (python3, node, or bash) with a timeout.
 */
export async function executeCode(
  language: string,
  code: string,
  timeoutMs: number,
): Promise<CodeResult> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    let stdoutBuf = "";
    let stderrBuf = "";

    const langMap: Record<string, { cmd: string; args: string[] }> = {
      python: { cmd: "python3", args: ["-c", code] },
      javascript: { cmd: "node", args: ["-e", code] },
      shell: { cmd: "bash", args: ["-c", code] }
    };

    const entry = langMap[language];
    if (!entry) {
      reject(new Error(`Unsupported language: ${language}`));
      return;
    }

    const proc = spawn(entry.cmd, entry.args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
      shell: false
    });

    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      resolve({
        exit_code: 124,
        stdout: stdoutBuf,
        stderr: `Process timed out after ${timeoutMs}ms`,
        execution_time_ms: Date.now() - startedAt
      });
    }, timeoutMs);

    proc.stdout.on("data", (chunk: Buffer) => {
      stdoutBuf += chunk.toString();
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      stderrBuf += chunk.toString();
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new Error(`Runtime not found for language '${language}': ${entry.cmd}`));
      } else {
        reject(err);
      }
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        exit_code: code ?? 1,
        stdout: stdoutBuf,
        stderr: stderrBuf,
        execution_time_ms: Date.now() - startedAt
      });
    });
  });
}
