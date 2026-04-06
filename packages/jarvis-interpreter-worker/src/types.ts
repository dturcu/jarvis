// ── interpreter.run_task ──────────────────────────────────────────────────────

export type InterpreterRunTaskInput = {
  task: string;
  context?: string;
  auto_approve: boolean;
  model?: string;
};

export type InterpreterStep = {
  type: "code" | "output" | "error";
  language?: string;
  content: string;
};

export type InterpreterRunTaskOutput = {
  session_id: string;
  steps: InterpreterStep[];
  final_output?: string;
  artifacts: string[];
};

// ── interpreter.run_code ──────────────────────────────────────────────────────

export type InterpreterRunCodeInput = {
  language: "python" | "javascript" | "shell";
  code: string;
  timeout_seconds: number;
};

export type InterpreterRunCodeOutput = {
  exit_code: number;
  stdout: string;
  stderr: string;
  execution_time_ms: number;
};

// ── interpreter.status ────────────────────────────────────────────────────────

export type InterpreterStatusInput = {
  session_id?: string;
};

export type InterpreterActiveSession = {
  session_id: string;
  task: string;
  started_at: string;
  status: "running" | "completed" | "failed";
};

export type InterpreterStatusOutput = {
  active_sessions: InterpreterActiveSession[];
};
