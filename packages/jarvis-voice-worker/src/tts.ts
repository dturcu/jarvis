import { spawn } from "node:child_process";

export async function synthesizeWithPiper(
  text: string,
  options: { voice?: string; speed?: number; outputPath: string },
): Promise<void> {
  const voice = options.voice ?? "en_US-lessac-medium";
  const speed = options.speed ?? 1.0;

  // Piper reads from stdin and writes WAV to the given output path
  const args = [
    "--model", voice,
    "--length_scale", String(1.0 / speed),
    "--output_file", options.outputPath
  ];

  return new Promise((resolve, reject) => {
    const proc = spawn("piper", args, { stdio: ["pipe", "pipe", "pipe"] });
    let stderr = "";

    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("error", (err) => {
      reject(new Error(`Piper TTS process failed: ${err.message}. stderr: ${stderr.slice(0, 300)}`));
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Piper TTS exited with code ${code}. stderr: ${stderr.slice(0, 300)}`));
        return;
      }
      resolve();
    });

    proc.stdin.write(text, "utf8");
    proc.stdin.end();
  });
}

export async function synthesizeWithSAPI(
  text: string,
  options: { voice?: string; speed?: number; outputPath: string },
): Promise<void> {
  const voice = options.voice ?? "";
  const rate = Math.round(((options.speed ?? 1.0) - 1.0) * 10); // SAPI rate: -10 to +10
  const escapedText = text.replace(/'/g, "''").replace(/"/g, '`"');
  const escapedPath = options.outputPath.replace(/'/g, "''");
  const escapedVoice = voice.replace(/'/g, "''");

  const voiceSetSnippet = escapedVoice
    ? `$synth.SelectVoice('${escapedVoice}');`
    : "";

  const script = [
    "Add-Type -AssemblyName System.Speech;",
    "$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer;",
    voiceSetSnippet,
    `$synth.Rate = ${rate};`,
    `$synth.SetOutputToWaveFile('${escapedPath}');`,
    `$synth.Speak('${escapedText}');`,
    "$synth.Dispose();"
  ].filter(Boolean).join(" ");

  return new Promise((resolve, reject) => {
    const proc = spawn(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stderr = "";

    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("error", (err) => {
      reject(new Error(`SAPI TTS process failed: ${err.message}. stderr: ${stderr.slice(0, 300)}`));
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`SAPI TTS exited with code ${code}. stderr: ${stderr.slice(0, 300)}`));
        return;
      }
      resolve();
    });
  });
}
