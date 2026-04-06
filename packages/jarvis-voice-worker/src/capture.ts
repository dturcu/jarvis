import { spawn } from "node:child_process";

export type CaptureResult = {
  format: string;
  sampleRate: number;
};

export async function captureAudio(options: {
  durationSeconds: number;
  deviceId?: string;
  outputPath: string;
}): Promise<CaptureResult> {
  const format = "wav";
  const sampleRate = 16000;

  // Try ffmpeg first (cross-platform)
  try {
    await captureWithFfmpeg(options, sampleRate);
    return { format, sampleRate };
  } catch {
    // Fall back to sox
    await captureWithSox(options, sampleRate);
    return { format, sampleRate };
  }
}

async function captureWithFfmpeg(
  options: { durationSeconds: number; deviceId?: string; outputPath: string },
  sampleRate: number,
): Promise<void> {
  const deviceId = options.deviceId ?? "default";

  // On Windows: use dshow; on Linux/Mac: alsa/avfoundation
  const isWindows = process.platform === "win32";
  const inputFormat = isWindows ? "dshow" : "alsa";
  const inputDevice = isWindows ? `audio=${deviceId}` : (options.deviceId ?? "default");

  const args = [
    "-f", inputFormat,
    "-i", inputDevice,
    "-t", String(options.durationSeconds),
    "-ar", String(sampleRate),
    "-ac", "1",
    "-y",
    options.outputPath
  ];

  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";

    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("error", (err) => {
      reject(new Error(`ffmpeg capture failed: ${err.message}`));
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg exited with code ${code}. stderr: ${stderr.slice(0, 300)}`));
        return;
      }
      resolve();
    });
  });
}

async function captureWithSox(
  options: { durationSeconds: number; deviceId?: string; outputPath: string },
  sampleRate: number,
): Promise<void> {
  const args = [
    "-t", "waveaudio",
    options.deviceId ?? "default",
    "-r", String(sampleRate),
    "-c", "1",
    "-b", "16",
    options.outputPath,
    "trim", "0", String(options.durationSeconds)
  ];

  return new Promise((resolve, reject) => {
    const proc = spawn("sox", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";

    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("error", (err) => {
      reject(new Error(`sox capture failed: ${err.message}`));
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`sox exited with code ${code}. stderr: ${stderr.slice(0, 300)}`));
        return;
      }
      resolve();
    });
  });
}
