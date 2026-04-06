import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

export type TranscriptionSegment = {
  start: number;
  end: number;
  text: string;
};

export type TranscriptionResult = {
  text: string;
  language: string;
  confidence: number;
  segments: TranscriptionSegment[];
};

type WhisperJsonOutput = {
  text?: string;
  language?: string;
  segments?: Array<{
    start?: number;
    end?: number;
    text?: string;
    avg_logprob?: number;
  }>;
};

function parseWhisperOutput(raw: string): TranscriptionResult {
  let parsed: WhisperJsonOutput;
  try {
    parsed = JSON.parse(raw) as WhisperJsonOutput;
  } catch {
    // Fallback: treat raw output as plain text
    return {
      text: raw.trim(),
      language: "en",
      confidence: 0.5,
      segments: [{ start: 0, end: 0, text: raw.trim() }]
    };
  }

  const text = parsed.text?.trim() ?? "";
  const language = parsed.language ?? "en";
  const segments: TranscriptionSegment[] = (parsed.segments ?? []).map((seg) => ({
    start: seg.start ?? 0,
    end: seg.end ?? 0,
    text: seg.text?.trim() ?? ""
  }));

  // Average log probability -> confidence (clamp to [0,1])
  const avgLogProb = (parsed.segments ?? []).reduce(
    (acc, seg) => acc + (seg.avg_logprob ?? -1),
    0,
  ) / Math.max(1, parsed.segments?.length ?? 1);
  const confidence = Math.max(0, Math.min(1, Math.exp(avgLogProb)));

  return { text, language, confidence, segments };
}

export async function transcribeWithWhisper(
  audioPath: string,
  options: { model?: string; language?: string },
): Promise<TranscriptionResult> {
  const model = options.model ?? "base";
  const args = [
    audioPath,
    "--model", model,
    "--output_format", "json",
    "--output_dir", "-"
  ];

  if (options.language) {
    args.push("--language", options.language);
  }

  return new Promise((resolve, reject) => {
    const proc = spawn("whisper", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("error", (err) => {
      // whisper.cpp not found, fall back to faster-whisper
      runFasterWhisper(audioPath, options).then(resolve).catch(() =>
        reject(new Error(`Whisper process failed: ${err.message}. stderr: ${stderr.slice(0, 300)}`))
      );
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        runFasterWhisper(audioPath, options).then(resolve).catch(() =>
          reject(new Error(`Whisper exited with code ${code}. stderr: ${stderr.slice(0, 300)}`))
        );
        return;
      }
      resolve(parseWhisperOutput(stdout));
    });
  });
}

async function runFasterWhisper(
  audioPath: string,
  options: { model?: string; language?: string },
): Promise<TranscriptionResult> {
  const model = options.model ?? "base";
  const args = [
    "-m", "faster_whisper",
    audioPath,
    "--model", model,
    "--output_format", "json"
  ];

  if (options.language) {
    args.push("--language", options.language);
  }

  return new Promise((resolve, reject) => {
    const proc = spawn("python", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("error", (err) => {
      reject(new Error(`faster-whisper process failed: ${err.message}. stderr: ${stderr.slice(0, 300)}`));
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`faster-whisper exited with code ${code}. stderr: ${stderr.slice(0, 300)}`));
        return;
      }
      resolve(parseWhisperOutput(stdout));
    });
  });
}

// Utility: generate a unique temp path for audio artifacts
export function generateAudioArtifactId(): string {
  return `audio-${randomUUID()}`;
}
