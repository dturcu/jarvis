import { beforeEach, describe, expect, it } from "vitest";
import {
  createDeviceCommand,
  createDeviceTools
} from "@jarvis/device";
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

describe("Jarvis device determinism", () => {
  beforeEach(() => {
    resetJarvisState();
  });

  it("builds the same open_app job spec from the tool and the /device command", async () => {
    const toolCtx = {
      agentId: "main",
      sessionKey: "agent:main:telegram:dm:123",
      messageChannel: "telegram",
      requesterSenderId: "123456789"
    };

    const tool = createDeviceTools(toolCtx).find(
      (entry) => entry.name === "device_open_app",
    );
    expect(tool).toBeDefined();

    const toolResult = await tool!.execute("tool-call-1", {
      appId: "notepad",
      arguments: [],
      waitForWindow: true
    });

    const toolEnvelope = extractEnvelope(toolResult.details.job_id!);

    resetJarvisState();

    const command = createDeviceCommand();
    const commandReply = command.handler({
      senderId: "123456789",
      channel: "telegram",
      isAuthorizedSender: true,
      sessionKey: "agent:main:telegram:dm:123",
      sessionId: "session-1",
      args: JSON.stringify({
        operation: "open_app",
        appId: "notepad",
        arguments: [],
        waitForWindow: true
      }),
      commandBody: "/device ...",
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
