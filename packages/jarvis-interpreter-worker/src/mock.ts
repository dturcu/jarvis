import { randomUUID } from "node:crypto";
import type { InterpreterAdapter, ExecutionOutcome } from "./adapter.js";
import { InterpreterWorkerError } from "./adapter.js";
import type {
  InterpreterActiveSession,
  InterpreterRunCodeInput,
  InterpreterRunCodeOutput,
  InterpreterRunTaskInput,
  InterpreterRunTaskOutput,
  InterpreterStatusInput,
  InterpreterStatusOutput
} from "./types.js";

export class MockInterpreterAdapter implements InterpreterAdapter {
  private sessions: Map<string, InterpreterActiveSession & { task_input: InterpreterRunTaskInput }> = new Map();
  private runTaskCalls: InterpreterRunTaskInput[] = [];
  private runCodeCalls: InterpreterRunCodeInput[] = [];

  getRunTaskCalls(): InterpreterRunTaskInput[] {
    return [...this.runTaskCalls];
  }

  getRunCodeCalls(): InterpreterRunCodeInput[] {
    return [...this.runCodeCalls];
  }

  async runTask(input: InterpreterRunTaskInput): Promise<ExecutionOutcome<InterpreterRunTaskOutput>> {
    this.runTaskCalls.push(input);

    const sessionId = randomUUID();
    const startedAt = new Date().toISOString();

    const session: InterpreterActiveSession & { task_input: InterpreterRunTaskInput } = {
      session_id: sessionId,
      task: input.task,
      started_at: startedAt,
      status: "completed",
      task_input: input
    };
    this.sessions.set(sessionId, session);

    const steps = [
      {
        type: "code" as const,
        language: "python",
        content: `# Mock code generated for task: ${input.task.slice(0, 50)}\nprint("Task completed")`
      },
      {
        type: "output" as const,
        content: `Task completed: ${input.task.slice(0, 80)}`
      }
    ];

    const finalOutput = `Completed task: ${input.task.slice(0, 100)}`;

    return {
      summary: `Interpreter task completed in ${steps.length} steps (session=${sessionId}).`,
      structured_output: {
        session_id: sessionId,
        steps,
        final_output: finalOutput,
        artifacts: []
      }
    };
  }

  async runCode(input: InterpreterRunCodeInput): Promise<ExecutionOutcome<InterpreterRunCodeOutput>> {
    this.runCodeCalls.push(input);

    const startMs = Date.now();
    // Simulate a brief delay proportional to code length
    const executionTimeMs = Math.min(10 + input.code.length * 0.5, input.timeout_seconds * 1000 * 0.1);
    const mockStdout = `Mock output for ${input.language} code:\n${input.code.slice(0, 100)}`;

    return {
      summary: `Code executed in ${input.language} (exit_code=0, ${Math.round(executionTimeMs)}ms).`,
      structured_output: {
        exit_code: 0,
        stdout: mockStdout,
        stderr: "",
        execution_time_ms: Math.round(Date.now() - startMs + executionTimeMs)
      }
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
      activeSessions = [{ session_id: session.session_id, task: session.task, started_at: session.started_at, status: session.status }];
    } else {
      activeSessions = [...this.sessions.values()].map((s) => ({
        session_id: s.session_id,
        task: s.task,
        started_at: s.started_at,
        status: s.status
      }));
    }

    return {
      summary: `Found ${activeSessions.length} interpreter session(s).`,
      structured_output: {
        active_sessions: activeSessions
      }
    };
  }

  // Test helper: set a session's status
  setSessionStatus(sessionId: string, status: InterpreterActiveSession["status"]): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.status = status;
    }
  }

  // Test helper: inject a running session
  addRunningSession(task: string): string {
    const sessionId = randomUUID();
    this.sessions.set(sessionId, {
      session_id: sessionId,
      task,
      started_at: new Date().toISOString(),
      status: "running",
      task_input: { task, auto_approve: false }
    });
    return sessionId;
  }
}

export function createMockInterpreterAdapter(): InterpreterAdapter {
  return new MockInterpreterAdapter();
}
