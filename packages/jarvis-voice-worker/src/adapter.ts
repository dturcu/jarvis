import type {
  VoiceListenInput,
  VoiceListenOutput,
  VoiceTranscribeInput,
  VoiceTranscribeOutput,
  VoiceSpeakInput,
  VoiceSpeakOutput,
  VoiceWakeWordStartInput,
  VoiceWakeWordStartOutput,
  VoiceWakeWordStopInput,
  VoiceWakeWordStopOutput
} from "./types.js";

export type VoiceExecutionOutcome<T> = {
  summary: string;
  structured_output: T;
};

export class VoiceWorkerError extends Error {
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
    this.name = "VoiceWorkerError";
    this.code = code;
    this.retryable = retryable;
    this.details = details;
  }
}

export interface VoiceAdapter {
  listen(input: VoiceListenInput): Promise<VoiceExecutionOutcome<VoiceListenOutput>>;
  transcribe(input: VoiceTranscribeInput): Promise<VoiceExecutionOutcome<VoiceTranscribeOutput>>;
  speak(input: VoiceSpeakInput): Promise<VoiceExecutionOutcome<VoiceSpeakOutput>>;
  wakeWordStart(input: VoiceWakeWordStartInput): Promise<VoiceExecutionOutcome<VoiceWakeWordStartOutput>>;
  wakeWordStop(input: VoiceWakeWordStopInput): Promise<VoiceExecutionOutcome<VoiceWakeWordStopOutput>>;
}
