import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Allow temp directory for tests — must be set before module import
process.env.JARVIS_FILES_ALLOWED_ROOTS = `${process.cwd()};${tmpdir()}`;

import { describe, expect, it } from "vitest";
import {
  createFilesCommand,
  createFilesTools,
  filesCommandNames,
  filesToolNames
} from "../packages/jarvis-files/src/index";
import { getJarvisState } from "../packages/jarvis-shared/src/state";

/** Create a real approval in the Jarvis state and resolve it as "approved". */
function createApprovedApproval(): string {
  const state = getJarvisState();
  const record = state.requestApproval({ title: "test", description: "test approval" });
  state.resolveApproval(record.approval_id, "approved");
  return record.approval_id;
}

function makeTempWorkspace() {
  return mkdtempSync(join(tmpdir(), "jarvis-files-"));
}

function makeCommandContext(args: string) {
  return {
    senderId: "123456789",
    channel: "telegram",
    isAuthorizedSender: true,
    sessionKey: "agent:main:telegram:dm:123",
    sessionId: "session-1",
    args,
    commandBody: "/files ...",
    config: {},
    requestConversationBinding: async () => ({ created: false }),
    detachConversationBinding: async () => ({ removed: false }),
    getCurrentConversationBinding: async () => null
  } as any;
}

describe("Jarvis files plugin", () => {
  it("exposes the expected surface", () => {
    expect(filesToolNames).toEqual([
      "files_inspect",
      "files_read",
      "files_search",
      "files_write",
      "files_patch",
      "files_copy",
      "files_move",
      "files_preview"
    ]);
    expect(filesCommandNames).toEqual(["/files"]);
    expect(createFilesTools().map((tool) => tool.name)).toEqual(filesToolNames);
  });

  it("shares deterministic read behavior between the tool and /files command", async () => {
    const rootPath = makeTempWorkspace();
    writeFileSync(join(rootPath, "notes.txt"), "alpha\nbeta\ngamma\n", "utf8");

    const tool = createFilesTools().find((entry) => entry.name === "files_read");
    expect(tool).toBeDefined();

    const toolResult = await tool!.execute("tool-call-1", {
      rootPath,
      path: "notes.txt"
    });

    const command = createFilesCommand();
    const commandReply = command.handler(
      makeCommandContext(
        JSON.stringify({
          operation: "read",
          rootPath,
          path: "notes.txt"
        })
      )
    );

    expect(commandReply.isError).toBeFalsy();
    expect(commandReply.text).toBe(toolResult.details.summary);
    expect(toolResult.details.structured_output).toMatchObject({
      path: "notes.txt",
      content: "alpha\nbeta\ngamma\n"
    });
  });

  it("gates destructive writes until approval and then applies the change", async () => {
    const rootPath = makeTempWorkspace();
    mkdirSync(rootPath, { recursive: true });

    const writeTool = createFilesTools().find((entry) => entry.name === "files_write");
    expect(writeTool).toBeDefined();

    const gated = await writeTool!.execute("tool-call-approval", {
      rootPath,
      path: "drafts/plan.txt",
      content: "first draft"
    });

    expect(gated.details.status).toBe("awaiting_approval");
    expect(existsSync(join(rootPath, "drafts", "plan.txt"))).toBe(false);

    const approvalId = createApprovedApproval();
    const approved = await writeTool!.execute("tool-call-approved", {
      rootPath,
      path: "drafts/plan.txt",
      content: "first draft",
      createDirectories: true,
      approvalId
    });

    expect(approved.details.status).toBe("completed");
    expect(readFileSync(join(rootPath, "drafts", "plan.txt"), "utf8")).toBe("first draft");
  });

  it("supports patching and previewing the updated content", async () => {
    const rootPath = makeTempWorkspace();
    const target = join(rootPath, "memo.txt");
    writeFileSync(target, "hello world\nhello jarvis\n", "utf8");

    const patchTool = createFilesTools().find((entry) => entry.name === "files_patch");
    const previewTool = createFilesTools().find((entry) => entry.name === "files_preview");
    expect(patchTool).toBeDefined();
    expect(previewTool).toBeDefined();

    const approvalId = createApprovedApproval();
    const patched = await patchTool!.execute("tool-call-patch", {
      rootPath,
      path: "memo.txt",
      operations: [{ find: "hello", replace: "hi", all: true }],
      approvalId
    });

    expect(patched.details.status).toBe("completed");
    expect(readFileSync(target, "utf8")).toBe("hi world\nhi jarvis\n");

    const preview = await previewTool!.execute("tool-call-preview", {
      rootPath,
      path: "memo.txt",
      maxLines: 1
    });

    expect(preview.details.structured_output).toMatchObject({
      path: "memo.txt",
      preview: "hi world"
    });
  });
});
