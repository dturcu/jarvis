export type VoiceListenInput = {
  duration_seconds: number;
  device_id?: string;
};

export type VoiceListenOutput = {
  audio_artifact_id: string;
  duration_seconds: number;
  format: string;
  sample_rate: number;
};

export type VoiceTranscribeInput = {
  audio_artifact_id: string;
  language?: string;
  model?: string;
};

export type VoiceTranscribeOutput = {
  text: string;
  language: string;
  confidence: number;
  segments: Array<{ start: number; end: number; text: string }>;
};

export type VoiceSpeakInput = {
  text: string;
  voice?: string;
  speed?: number;
  output_name?: string;
};

export type VoiceSpeakOutput = {
  audio_artifact_id: string;
  duration_seconds: number;
  voice: string;
  format: string;
};

export type VoiceWakeWordStartInput = {
  keyword: string;
  sensitivity: number;
};

export type VoiceWakeWordStartOutput = {
  session_id: string;
  keyword: string;
  listening: boolean;
};

export type VoiceWakeWordStopInput = Record<string, never>;

export type VoiceWakeWordStopOutput = {
  session_id: string;
  stopped: boolean;
};
