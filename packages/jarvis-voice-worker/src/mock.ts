import { randomUUID } from "node:crypto";
import type { VoiceAdapter, VoiceExecutionOutcome } from "./adapter.js";
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

export class MockVoiceAdapter implements VoiceAdapter {
  private activeSessionId: string | null = null;
  private listenCalls: VoiceListenInput[] = [];
  private transcribeCalls: VoiceTranscribeInput[] = [];
  private speakCalls: VoiceSpeakInput[] = [];
  private wakeWordStartCalls: VoiceWakeWordStartInput[] = [];
  private wakeWordStopCalls: number = 0;

  getListenCalls(): VoiceListenInput[] { return [...this.listenCalls]; }
  getTranscribeCalls(): VoiceTranscribeInput[] { return [...this.transcribeCalls]; }
  getSpeakCalls(): VoiceSpeakInput[] { return [...this.speakCalls]; }
  getWakeWordStartCalls(): VoiceWakeWordStartInput[] { return [...this.wakeWordStartCalls]; }
  getWakeWordStopCount(): number { return this.wakeWordStopCalls; }
  getActiveSessionId(): string | null { return this.activeSessionId; }

  async listen(input: VoiceListenInput): Promise<VoiceExecutionOutcome<VoiceListenOutput>> {
    this.listenCalls.push(input);
    const artifactId = `audio-${randomUUID()}`;
    const duration = input.duration_seconds;

    return {
      summary: `Captured ${duration}s of audio from device '${input.device_id ?? "default"}'.`,
      structured_output: {
        audio_artifact_id: artifactId,
        duration_seconds: duration,
        format: "wav",
        sample_rate: 16000
      }
    };
  }

  async transcribe(input: VoiceTranscribeInput): Promise<VoiceExecutionOutcome<VoiceTranscribeOutput>> {
    this.transcribeCalls.push(input);
    const language = input.language ?? "en";
    const text = "Hello, this is a mock transcription of the audio.";

    return {
      summary: `Transcribed audio artifact '${input.audio_artifact_id}' using model '${input.model ?? "base"}' in language '${language}'.`,
      structured_output: {
        text,
        language,
        confidence: 0.92,
        segments: [
          { start: 0.0, end: 0.8, text: "Hello," },
          { start: 0.8, end: 1.9, text: " this is" },
          { start: 1.9, end: 3.5, text: " a mock transcription of the audio." }
        ]
      }
    };
  }

  async speak(input: VoiceSpeakInput): Promise<VoiceExecutionOutcome<VoiceSpeakOutput>> {
    this.speakCalls.push(input);
    const voice = input.voice ?? "en_US-lessac-medium";
    const artifactId = `tts-${randomUUID()}`;
    const charCount = input.text.length;
    const estimatedDuration = charCount / (14 * (input.speed ?? 1.0));

    return {
      summary: `Synthesised ${charCount} characters of text using voice '${voice}'.`,
      structured_output: {
        audio_artifact_id: artifactId,
        duration_seconds: Number(estimatedDuration.toFixed(2)),
        voice,
        format: "wav"
      }
    };
  }

  async wakeWordStart(input: VoiceWakeWordStartInput): Promise<VoiceExecutionOutcome<VoiceWakeWordStartOutput>> {
    this.wakeWordStartCalls.push(input);
    const sessionId = `ww-${randomUUID()}`;
    this.activeSessionId = sessionId;

    return {
      summary: `Wake word detection started for keyword '${input.keyword}' with sensitivity ${input.sensitivity}.`,
      structured_output: {
        session_id: sessionId,
        keyword: input.keyword,
        listening: true
      }
    };
  }

  async wakeWordStop(_input: VoiceWakeWordStopInput): Promise<VoiceExecutionOutcome<VoiceWakeWordStopOutput>> {
    this.wakeWordStopCalls++;
    const sessionId = this.activeSessionId ?? `ww-${randomUUID()}`;
    this.activeSessionId = null;

    return {
      summary: `Wake word detection session '${sessionId}' stopped.`,
      structured_output: {
        session_id: sessionId,
        stopped: true
      }
    };
  }
}

export function createMockVoiceAdapter(): VoiceAdapter {
  return new MockVoiceAdapter();
}
