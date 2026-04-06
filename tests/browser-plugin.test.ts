import { beforeEach, describe, expect, it } from "vitest";
import {
  browserCommandNames,
  browserToolNames,
  createBrowserCommand,
  createBrowserTools
} from "../packages/jarvis-browser/src/index.ts";
import {
  getJarvisState,
  resetJarvisState
} from "@jarvis/shared";

function extractEnvelope(jobId: string) {
  const response = getJarvisState().getJob(jobId);
  return (response.structured_output as {
    envelope: Record<string, unknown>;
  }).envelope;
}

function extractJobIdFromReply(text: string): string {
  const match = text.match(/job=([0-9a-f-]+)/i);
  expect(match?.[1]).toBeTruthy();
  return match![1];
}

describe("Jarvis browser plugin", () => {
  beforeEach(() => {
    resetJarvisState();
  });

  it("exposes the expected deterministic surface", () => {
    expect(browserToolNames).toEqual([
      "browser_run_task",
      "browser_extract",
      "browser_capture",
      "browser_download"
    ]);
    expect(browserCommandNames).toEqual(["/browser"]);
  });

  it("builds the same job spec from the tool and the /browser command", async () => {
    const toolCtx = {
      agentId: "main",
      sessionKey: "agent:main:telegram:dm:123",
      messageChannel: "telegram",
      requesterSenderId: "123456789"
    };

    const runTaskTool = createBrowserTools(toolCtx).find(
      (tool) => tool.name === "browser_run_task",
    );
    expect(runTaskTool).toBeDefined();

    const toolResult = await runTaskTool!.execute("tool-call-1", {
      targetUrl: "https://example.com",
      task: "collect the headline and store a preview",
      outputName: "browser-run.json",
      allowDownloads: true,
      waitForIdle: false
    });

    const toolEnvelope = extractEnvelope(toolResult.details.job_id!);

    resetJarvisState();

    const command = createBrowserCommand();
    const commandReply = command.handler({
      senderId: "123456789",
      channel: "telegram",
      isAuthorizedSender: true,
      sessionKey: "agent:main:telegram:dm:123",
      sessionId: "session-1",
      args: JSON.stringify({
        operation: "run_task",
        targetUrl: "https://example.com",
        task: "collect the headline and store a preview",
        outputName: "browser-run.json",
        allowDownloads: true,
        waitForIdle: false
      }),
      commandBody: "/browser ...",
      config: {},
      requestConversationBinding: async () => ({ created: false }),
      detachConversationBinding: async () => ({ removed: false }),
      getCurrentConversationBinding: async () => null
    } as any);

    const commandEnvelope = extractEnvelope(extractJobIdFromReply(commandReply.text));

    expect(commandEnvelope).toMatchObject({
      type: toolEnvelope.type,
      session_key: toolEnvelope.session_key,
      requested_by: toolEnvelope.requested_by,
      priority: toolEnvelope.priority,
      input: toolEnvelope.input,
      artifacts_in: toolEnvelope.artifacts_in,
      metadata: {
        agent_id: (toolEnvelope.metadata as Record<string, unknown>).agent_id
      }
    });
  });
});
