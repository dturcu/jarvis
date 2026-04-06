import { describe, expect, it, beforeEach } from "vitest";
import {
  createExcelCommand,
  createOfficeTools
} from "@jarvis/office";
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

describe("Jarvis office determinism", () => {
  beforeEach(() => {
    resetJarvisState();
  });

  it("builds the same merge job spec from the tool and the /excel command", async () => {
    const toolCtx = {
      agentId: "main",
      sessionKey: "agent:main:telegram:dm:123",
      messageChannel: "telegram",
      requesterSenderId: "123456789"
    };

    const mergeTool = createOfficeTools(toolCtx).find(
      (tool) => tool.name === "office_merge_excel",
    );
    expect(mergeTool).toBeDefined();

    const toolResult = await mergeTool!.execute("tool-call-1", {
      artifactIds: ["a1", "a2"],
      mode: "by_header_union",
      outputName: "merged.xlsx",
      sheetPolicy: "first_sheet",
      dedupeKeys: ["SKU", "Date"]
    });

    const toolEnvelope = extractEnvelope(toolResult.details.job_id!);

    resetJarvisState();

    const command = createExcelCommand();
    const commandReply = command.handler({
      senderId: "123456789",
      channel: "telegram",
      isAuthorizedSender: true,
      sessionKey: "agent:main:telegram:dm:123",
      sessionId: "session-1",
      args: JSON.stringify({
        operation: "merge_excel",
        artifactIds: ["a1", "a2"],
        mode: "by_header_union",
        outputName: "merged.xlsx",
        sheetPolicy: "first_sheet",
        dedupeKeys: ["SKU", "Date"]
      }),
      commandBody: "/excel ...",
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
