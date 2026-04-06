import { randomUUID } from "node:crypto";
import type { InterpreterAdapter, ExecutionOutcome } from "./adapter.js";
import { InterpreterWorkerError } from "./adapter.js";
import type {
  InterpreterRunTaskInput, InterpreterRunTaskOutput, InterpreterStep,
  InterpreterRunCodeInput, InterpreterRunCodeOutput,
  InterpreterStatusInput, InterpreterStatusOutput,
  InterpreterActiveSession
} from "./types.js";
import { spawnInterpreter, executeCode, type CodeResult } from "./subprocess.js";

/**
 * A function that calls an LLM and returns the text response.
 * Used by runTask to generate code from a task description.
 */
export type LlmChatFn = (prompt: string, systemPrompt?: string) => Promise<string>;

type SessionRecord = {
  session_id: string;
  task: string;
  started_at: string;
  status: InterpreterActiveSession["status"];
};

/**
 * Real interpreter adapter that executes code via child_process.
 *
 * - runTask: Uses Open Interpreter CLI or falls back to LLM-generated code execution.
 * - runCode: Spawns python3/node/bash (or Windows equivalents) with timeout.
 * - status: Tracks sessions in memory.
 */
export class RealInterpreterAdapter implements InterpreterAdapter {
  private sessions = new Map<string, SessionRecord>();
  private readonly chat?: LlmChatFn;
  private readonly isWindows: boolean;

  constructor(options: { chat?: LlmChatFn } = {}) {
    this.chat = options.chat;
    this.isWindows = process.platform === "win32";
  }

  async runTask(input: InterpreterRunTaskInput): Promise<ExecutionOutcome<InterpreterRunTaskOutput>> {
    const sessionId = randomUUID();
    const startedAt = new Date().toISOString();

    this.sessions.set(sessionId, {
      session_id: sessionId,
      task: input.task,
      started_at: startedAt,
      status: "running",
    });

    try {
      // Try Open Interpreter first
      const session = await spawnInterpreter(input.task, {
        model: input.model,
        autoRun: input.auto_approve,
      });

      this.sessions.set(sessionId, {
        session_id: sessionId,
        task: input.task,
        started_at: startedAt,
        status: "completed",
      });

      return {
        summary: `Interpreter task completed in ${session.output.steps.length} step(s) (session=${sessionId}).`,
        structured_output: {
          session_id: sessionId,
          steps: session.output.steps,
          final_output: session.output.final_output,
          artifacts: session.output.artifacts,
        },
      };
    } catch (interpreterError) {
      // If Open Interpreter is not installed, fall back to LLM-generated code
      if (this.chat && (interpreterError as Error).message?.includes("not installed")) {
        return this.runTaskViaLlm(sessionId, startedAt, input);
      }

      this.sessions.set(sessionId, {
        session_id: sessionId,
        task: input.task,
        started_at: startedAt,
        status: "failed",
      });

      throw new InterpreterWorkerError(
        "INTERPRETER_SPAWN_FAILED",
        `Failed to spawn interpreter: ${(interpreterError as Error).message}`,
        true,
        { session_id: sessionId }
      );
    }
  }

  async runCode(input: InterpreterRunCodeInput): Promise<ExecutionOutcome<InterpreterRunCodeOutput>> {
    const timeoutMs = input.timeout_seconds * 1000;
    let result: CodeResult;

    try {
      if (input.language === "shell" && this.isWindows) {
        result = await this.executeWindowsShell(input.code, timeoutMs);
      } else if (input.language === "python") {
        result = await this.executePython(input.code, timeoutMs);
      } else {
        result = await executeCode(input.language, input.code, timeoutMs);
      }
    } catch (error) {
      const message = (error as Error).message ?? "Unknown execution error";

      if (message.includes("Runtime not found") || message.includes("ENOENT")) {
        throw new InterpreterWorkerError(
          "RUNTIME_NOT_FOUND",
          `Runtime not available for ${input.language}: ${message}`,
          false,
          { language: input.language }
        );
      }

      throw new InterpreterWorkerError(
        "EXECUTION_FAILED",
        `Code execution failed: ${message}`,
        true,
        { language: input.language }
      );
    }

    const exitStatus = result.exit_code === 0 ? "success" : result.exit_code === 124 ? "timeout" : "error";

    return {
      summary: `Code executed in ${input.language} (exit_code=${result.exit_code}, ${result.execution_time_ms}ms, ${exitStatus}).`,
      structured_output: {
        exit_code: result.exit_code,
        stdout: result.stdout,
        stderr: result.stderr,
        execution_time_ms: result.execution_time_ms,
      },
    };
  }

  async status(input: InterpreterStatusInput): Promise<ExecutionOutcome<InterpreterStatusOutput>> {
    let activeSessions: InterpreterActiveSession[];

    if (input.session_id) {
      const session = this.sessions.get(input.session_id);
      if (!session) {
        throw new InterpreterWorkerError(
          "SESSION_NOT_FOUND",
          `Session '${input.session_id}' was not found.`,
          false
        );
      }
      activeSessions = [{
        session_id: session.session_id,
        task: session.task,
        started_at: session.started_at,
        status: session.status,
      }];
    } else {
      activeSessions = [...this.sessions.values()].map(s => ({
        session_id: s.session_id,
        task: s.task,
        started_at: s.started_at,
        status: s.status,
      }));
    }

    return {
      summary: `Found ${activeSessions.length} interpreter session(s).`,
      structured_output: {
        active_sessions: activeSessions,
      },
    };
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  /**
   * Fallback: use LLM to generate code for a task, then execute it.
   */
  private async runTaskViaLlm(
    sessionId: string,
    startedAt: string,
    input: InterpreterRunTaskInput,
  ): Promise<ExecutionOutcome<InterpreterRunTaskOutput>> {
    if (!this.chat) {
      this.sessions.set(sessionId, {
        session_id: sessionId,
        task: input.task,
        started_at: startedAt,
        status: "failed",
      });
      throw new InterpreterWorkerError(
        "NO_INTERPRETER",
        "Open Interpreter is not installed and no LLM chat function was provided for fallback code generation.",
        false
      );
    }

    const steps: InterpreterStep[] = [];

    const systemPrompt = `You are a code generation assistant. Given a task, output ONLY executable Python code that accomplishes the task. No explanation, no markdown fences, just the code.${input.context ? `\n\nContext: ${input.context}` : ""}`;
    const generatedCode = await this.chat(input.task, systemPrompt);

    steps.push({
      type: "code",
      language: "python",
      content: generatedCode,
    });

    // Execute the generated code
    try {
      const result = await this.executePython(generatedCode, 120_000);

      if (result.stdout) {
        steps.push({ type: "output", content: result.stdout });
      }
      if (result.stderr && result.exit_code !== 0) {
        steps.push({ type: "error", content: result.stderr });
      }

      const finalOutput = result.stdout.trim() || undefined;

      this.sessions.set(sessionId, {
        session_id: sessionId,
        task: input.task,
        started_at: startedAt,
        status: result.exit_code === 0 ? "completed" : "failed",
      });

      return {
        summary: `Task completed via LLM fallback in ${steps.length} step(s) (exit_code=${result.exit_code}, session=${sessionId}).`,
        structured_output: {
          session_id: sessionId,
          steps,
          final_output: finalOutput,
          artifacts: [],
        },
      };
    } catch (error) {
      steps.push({ type: "error", content: (error as Error).message });

      this.sessions.set(sessionId, {
        session_id: sessionId,
        task: input.task,
        started_at: startedAt,
        status: "failed",
      });

      return {
        summary: `Task failed via LLM fallback (session=${sessionId}): ${(error as Error).message}`,
        structured_output: {
          session_id: sessionId,
          steps,
          final_output: undefined,
          artifacts: [],
        },
      };
    }
  }

  /**
   * Execute Python code, trying python3 first, then python on Windows.
   */
  private async executePython(code: string, timeoutMs: number): Promise<CodeResult> {
    try {
      return await executeCode("python", code, timeoutMs);
    } catch (error) {
      // On Windows, python3 may not exist; try "python" directly
      if (this.isWindows && (error as Error).message?.includes("Runtime not found")) {
        return this.executeWithSpawn("python", ["-c", code], timeoutMs);
      }
      throw error;
    }
  }

  /**
   * Execute a shell command on Windows using PowerShell.
   */
  private async executeWindowsShell(code: string, timeoutMs: number): Promise<CodeResult> {
    return this.executeWithSpawn("powershell", ["-Command", code], timeoutMs);
  }

  /**
   * Generic spawn + capture with timeout.
   */
  private executeWithSpawn(cmd: string, args: string[], timeoutMs: number): Promise<CodeResult> {
    const { spawn } = require("node:child_process") as typeof import("node:child_process");

    return new Promise((resolve, reject) => {
      const startedAt = Date.now();
      let stdoutBuf = "";
      let stderrBuf = "";

      const proc = spawn(cmd, args, {
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env,
        shell: false,
      });

      const timer = setTimeout(() => {
        proc.kill("SIGKILL");
        resolve({
          exit_code: 124,
          stdout: stdoutBuf,
          stderr: `Process timed out after ${timeoutMs}ms`,
          execution_time_ms: Date.now() - startedAt,
        });
      }, timeoutMs);

      proc.stdout.on("data", (chunk: Buffer) => {
        stdoutBuf += chunk.toString();
      });

      proc.stderr.on("data", (chunk: Buffer) => {
        stderrBuf += chunk.toString();
      });

      proc.on("error", (err: NodeJS.ErrnoException) => {
        clearTimeout(timer);
        if (err.code === "ENOENT") {
          reject(new Error(`Runtime not found: ${cmd}`));
        } else {
          reject(err);
        }
      });

      proc.on("close", (code: number | null) => {
        clearTimeout(timer);
        resolve({
          exit_code: code ?? 1,
          stdout: stdoutBuf,
          stderr: stderrBuf,
          execution_time_ms: Date.now() - startedAt,
        });
      });
    });
  }
}

export function createRealInterpreterAdapter(options: { chat?: LlmChatFn } = {}): InterpreterAdapter {
  return new RealInterpreterAdapter(options);
}
