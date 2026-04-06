import { readFileSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  getJarvisState,
  resetJarvisState,
  submitDeviceClick,
  submitDeviceOpenApp,
  submitDeviceSnapshot,
  type JobEnvelope
} from "@jarvis/shared";
import {
  createDesktopHostWorker,
  createPowerShellDesktopHostAdapter
} from "@jarvis/desktop-host-worker";

type ExampleFile = {
  job_envelope: JobEnvelope;
};

function readExampleEnvelope(name: string): JobEnvelope {
  const fileUrl = new URL(`../contracts/jarvis/v1/examples/${name}`, import.meta.url);
  return (JSON.parse(readFileSync(fileUrl, "utf8")) as ExampleFile).job_envelope;
}

function extractEnvelope(jobId: string): JobEnvelope {
  const response = getJarvisState().getJob(jobId);
  return (response.structured_output as { envelope: JobEnvelope }).envelope;
}

function createPowerShellRunnerFixture(options: {
  windows?: Array<Record<string, unknown>>;
  displays?: Array<Record<string, unknown>>;
  clipboardText?: string;
  screenshotBytes?: string;
} = {}) {
  const calls: string[] = [];
  let windowQueries = 0;
  const initialWindows =
    options.windows ??
    [
      {
        window_id: "hwnd:1001",
        title: "Windows Terminal",
        app_id: "terminal",
        process_id: 4001,
        is_focused: true,
        is_minimized: false,
        bounds: { x: 100, y: 100, width: 1280, height: 720 }
      },
      {
        window_id: "hwnd:1002",
        title: "Project Notes",
        app_id: "notes",
        process_id: 4002,
        is_focused: false,
        is_minimized: false,
        bounds: { x: 220, y: 180, width: 960, height: 640 }
      }
    ];

  const runner = async (script: string) => {
    calls.push(script);
    const lines = script
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const lastLine = lines.at(-1) ?? "";
    const invocation =
      lastLine.startsWith("| ConvertTo-Json")
        ? lines.at(-2) ?? ""
        : lastLine;

    if (invocation.startsWith("Get-JarvisWindows")) {
      windowQueries += 1;
      const windows =
        windowQueries >= 2
          ? [
              ...initialWindows,
              {
                window_id: "hwnd:4242",
                title: "Notepad",
                app_id: "notepad",
                process_id: 4242,
                is_focused: true,
                is_minimized: false,
                bounds: { x: 300, y: 200, width: 1000, height: 700 }
              }
            ]
          : initialWindows;
      return JSON.stringify(windows);
    }

    if (invocation.startsWith("Get-JarvisDisplays")) {
      return JSON.stringify(
        options.displays ?? [
          {
            display_id: "DISPLAY1",
            width: 1920,
            height: 1080,
            scale_factor: 1,
            is_primary: true
          }
        ],
      );
    }

    if (invocation.startsWith("Get-JarvisDesktopBounds")) {
      return JSON.stringify({ x: 0, y: 0, width: 1920, height: 1080 });
    }

    if (invocation.startsWith("Start-JarvisApp")) {
      return JSON.stringify({ process_id: 4242 });
    }

    if (invocation.startsWith("Save-Screenshot")) {
      const match = /Save-Screenshot\s+'((?:''|[^'])+)'/s.exec(invocation);
      if (match) {
        const outputPath = match[1]!.replaceAll("''", "'");
        await writeFile(outputPath, options.screenshotBytes ?? "fake-screenshot");
      }
      return "{}";
    }

    if (invocation.startsWith("Read-JarvisClipboardText")) {
      return JSON.stringify({ text: options.clipboardText ?? "Draft proposal for Acme" });
    }

    if (invocation.startsWith("Read-JarvisClipboardFiles")) {
      return JSON.stringify({ files: ["C:\\Jarvis\\artifacts\\brief.docx"] });
    }

    if (invocation.startsWith("Read-JarvisClipboardImage")) {
      return JSON.stringify({
        artifact: {
          artifact_id: "artifact-clipboard",
          kind: "png",
          name: "clipboard.png",
          path: "C:\\Jarvis\\artifacts\\clipboard.png",
          path_context: "windows-host",
          path_style: "windows",
          size_bytes: 12
        }
      });
    }

    return "{}";
  };

  return { calls, runner };
}

describe("PowerShell desktop host adapter", () => {
  beforeEach(() => {
    resetJarvisState();
  });

  it("executes a realistic snapshot flow and materializes a screenshot artifact", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "jarvis-desktop-host-"));
    const { calls, runner } = createPowerShellRunnerFixture();
    const worker = createDesktopHostWorker({
      adapter: createPowerShellDesktopHostAdapter({
        runner,
        artifactRoot: tempRoot,
        host: { platform: "windows", hostname: "jarvis-station", user: "operator" }
      }),
      now: () => new Date("2026-04-04T12:00:00Z")
    });

    const submitResponse = submitDeviceSnapshot(
      {
        agentId: "main",
        sessionKey: "agent:main:telegram:dm:123",
        messageChannel: "telegram",
        requesterSenderId: "123456789"
      } as any,
      {
        includeWindows: true,
        includeDisplays: true,
        includeClipboard: true,
        includeActiveWindow: true,
        captureScreenshot: true,
        outputName: "snapshot.png"
      },
    );
    const envelope = extractEnvelope(submitResponse.job_id!);
    const result = await worker.execute(envelope);

    expect(result.status).toBe("completed");
    expect(result.structured_output?.host).toMatchObject({
      platform: "windows",
      hostname: "jarvis-station",
      user: "operator"
    });
    expect(result.artifacts?.[0]?.path_context).toBe("windows-host");
    expect(result.artifacts?.[0]?.path_style).toBe("windows");
    expect(result.artifacts?.[0]?.path).toContain(tempRoot);
    expect(result.structured_output?.screenshot_artifact_id).toBe(result.artifacts?.[0]?.artifact_id);
    expect(calls.some((script) => script.includes("Save-Screenshot"))).toBe(true);
  });

  it("launches an app and waits for the matching window to appear", async () => {
    const { calls, runner } = createPowerShellRunnerFixture();
    const worker = createDesktopHostWorker({
      adapter: createPowerShellDesktopHostAdapter({ runner }),
      now: () => new Date("2026-04-04T12:00:00Z")
    });

    const submitResponse = submitDeviceOpenApp(
      {
        agentId: "main",
        sessionKey: "agent:main:telegram:dm:123",
        messageChannel: "telegram",
        requesterSenderId: "123456789"
      } as any,
      {
        appId: "notepad",
        displayName: "Notepad",
        waitForWindow: true,
        arguments: []
      },
    );

    const envelope = extractEnvelope(submitResponse.job_id!);
    const result = await worker.execute(envelope);

    expect(result.status).toBe("completed");
    expect(result.structured_output?.window).toMatchObject({
      app_id: "notepad",
      title: "Notepad"
    });
    expect(calls.some((script) => script.includes("Start-JarvisApp"))).toBe(true);
    expect(calls.filter((script) => script.includes("Get-JarvisWindows")).length).toBeGreaterThan(1);
  });

  it("injects pointer clicks through the local PowerShell runner", async () => {
    const { calls, runner } = createPowerShellRunnerFixture();
    const worker = createDesktopHostWorker({
      adapter: createPowerShellDesktopHostAdapter({ runner }),
      now: () => new Date("2026-04-04T12:00:00Z")
    });

    const envelope = {
      ...readExampleEnvelope("device.click.json"),
      approval_state: "approved" as const
    };
    const result = await worker.execute(envelope);

    expect(result.status).toBe("completed");
    expect(result.structured_output).toMatchObject({
      performed: true,
      button: "left"
    });
    expect(calls.some((script) => script.includes("Set-CursorPos"))).toBe(true);
    expect(calls.some((script) => script.includes("Invoke-MouseClick"))).toBe(true);
  });
});
