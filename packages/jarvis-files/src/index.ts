import { randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { Type } from "@sinclair/typebox";
import {
  definePluginEntry,
  type AnyAgentTool,
  type OpenClawPluginToolContext,
  type PluginCommandContext
} from "openclaw/plugin-sdk/plugin-entry";
import {
  createToolResponse,
  getJarvisState,
  safeJsonParse,
  toCommandReply,
  toToolResult,
  type ToolResponse
} from "@jarvis/shared";

export const FILES_TOOL_NAMES = [
  "files_inspect",
  "files_read",
  "files_search",
  "files_write",
  "files_patch",
  "files_copy",
  "files_move",
  "files_preview"
] as const;

export const FILES_COMMAND_NAMES = ["/files"] as const;

/** Maximum file size (in bytes) for content search — skip files larger than 10 MB. */
const MAX_FILE_SIZE = 10 * 1024 * 1024;

/** Maximum number of entries returned during a recursive directory listing. */
const MAX_RECURSIVE_ENTRIES = 10_000;

type FileEncoding = "utf8" | "base64";

type FilesInspectParams = {
  rootPath?: string;
  paths: string[];
  recursive?: boolean;
  includeStats?: boolean;
  previewLines?: number;
};

type FilesReadParams = {
  rootPath?: string;
  path: string;
  encoding?: FileEncoding;
};

type FilesSearchParams = {
  rootPath?: string;
  query: string;
  caseSensitive?: boolean;
  includeContents?: boolean;
  maxResults?: number;
};

type FilesWriteParams = {
  rootPath?: string;
  path: string;
  content: string;
  encoding?: FileEncoding;
  createDirectories?: boolean;
  overwrite?: boolean;
  approvalId?: string;
};

type FilesPatchOperation = {
  find: string;
  replace: string;
  all?: boolean;
};

type FilesPatchParams = {
  rootPath?: string;
  path: string;
  operations: FilesPatchOperation[];
  encoding?: FileEncoding;
  createDirectories?: boolean;
  approvalId?: string;
};

type FilesCopyParams = {
  rootPath?: string;
  sourcePath: string;
  destinationPath: string;
  createDirectories?: boolean;
  overwrite?: boolean;
  approvalId?: string;
};

type FilesMoveParams = FilesCopyParams;

type FilesPreviewParams = {
  rootPath?: string;
  path: string;
  maxLines?: number;
  encoding?: FileEncoding;
};

type FilesCommandArgs =
  | ({ operation: "inspect" } & FilesInspectParams)
  | ({ operation: "read" } & FilesReadParams)
  | ({ operation: "search" } & FilesSearchParams)
  | ({ operation: "write" } & FilesWriteParams)
  | ({ operation: "patch" } & FilesPatchParams)
  | ({ operation: "copy" } & FilesCopyParams)
  | ({ operation: "move" } & FilesMoveParams)
  | ({ operation: "preview" } & FilesPreviewParams);

type ToolResultPayload = ToolResponse & {
  structured_output?: Record<string, unknown>;
};

function asLiteralUnion<const Values extends readonly [string, ...string[]]>(
  values: Values,
) {
  return Type.Union(values.map((value) => Type.Literal(value)) as [any, any, ...any[]]);
}

const encodingSchema = asLiteralUnion(["utf8", "base64"] as const);

function createFilesTool(
  name: (typeof FILES_TOOL_NAMES)[number],
  label: string,
  description: string,
  parameters: ReturnType<typeof Type.Object>,
  execute: (params: any) => ToolResultPayload,
): AnyAgentTool {
  return {
    name,
    label,
    description,
    parameters,
    execute: async (_toolCallId, params) => toToolResult(execute(params))
  };
}

/** Allowed root directories for the files broker.  Caller-supplied roots must
 *  fall under one of these prefixes.  JARVIS_FILES_ALLOWED_ROOTS accepts a
 *  semicolon-separated list; JARVIS_FILES_ROOT is a single directory.
 *  Falls back to cwd when neither is set.  Lazy-evaluated so tests can set
 *  the env var before first call. */
let _allowedRoots: string[] | null = null;
function getAllowedRoots(): string[] {
  if (!_allowedRoots) {
    const multi = process.env.JARVIS_FILES_ALLOWED_ROOTS;
    _allowedRoots = multi
      ? multi.split(";").map((p) => resolve(p.trim())).filter(Boolean)
      : [resolve(process.env.JARVIS_FILES_ROOT ?? process.cwd())];
  }
  return _allowedRoots;
}

function normalizeRoot(rootPath?: string): string {
  const resolved = resolve(rootPath?.trim() || process.cwd());

  // Reject roots that escape allowed directories
  const allowed = getAllowedRoots();
  const permitted = allowed.some(
    (a) => resolved === a || resolved.startsWith(a + "/") || resolved.startsWith(a + "\\"),
  );
  if (!permitted) {
    throw new Error(`Root path is outside allowed directories: ${resolved}`);
  }

  return resolved;
}

function assertPathWithinRoot(rootPath: string, candidatePath: string): string {
  const absolutePath = isAbsolute(candidatePath)
    ? resolve(candidatePath)
    : resolve(rootPath, candidatePath);
  const relativePath = relative(rootPath, absolutePath);
  if (relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath))) {
    return absolutePath;
  }
  throw new Error(`Path escapes approved root: ${candidatePath}`);
}

function maybeCreateDirectory(targetPath: string): void {
  mkdirSync(dirname(targetPath), { recursive: true });
}

function readText(filePath: string, encoding: FileEncoding = "utf8"): string {
  return readFileSync(filePath, encoding);
}

function writeText(filePath: string, content: string, encoding: FileEncoding = "utf8"): void {
  writeFileSync(filePath, content, encoding);
}

function approvalRequired(operation: string, target: string): ToolResultPayload {
  return createToolResponse({
    status: "awaiting_approval",
    summary: `Approval required before ${operation} ${target}.`,
    approval_id: randomUUID(),
    structured_output: {
      approval_required: true,
      operation,
      target
    }
  });
}

function success(
  summary: string,
  structured_output: Record<string, unknown>,
  artifacts?: ToolResultPayload["artifacts"],
): ToolResultPayload {
  return createToolResponse({
    status: "completed",
    summary,
    structured_output,
    artifacts
  });
}

function failure(code: string, message: string, field?: string): ToolResultPayload {
  return createToolResponse({
    status: "failed",
    summary: message,
    error: {
      code,
      message,
      retryable: false,
      field
    }
  });
}

function toPreviewText(content: string, maxLines = 12): string {
  return content.split(/\r?\n/).slice(0, maxLines).join("\n");
}

function listDirectoryEntries(
  rootPath: string,
  currentPath: string,
  recursive: boolean,
  includeStats: boolean,
  previewLines: number,
  counter: { count: number } = { count: 0 },
): Array<Record<string, unknown>> {
  const entries = readdirSync(currentPath, { withFileTypes: true });
  const results: Array<Record<string, unknown>> = [];

  for (const entry of entries) {
    if (counter.count >= MAX_RECURSIVE_ENTRIES) {
      results.push({ note: `Listing truncated at ${MAX_RECURSIVE_ENTRIES} entries.` });
      break;
    }

    const absolute = join(currentPath, entry.name);
    const entryRecord: Record<string, unknown> = {
      path: relative(rootPath, absolute) || ".",
      kind: entry.isDirectory() ? "directory" : "file"
    };

    if (includeStats) {
      const stats = statSync(absolute);
      entryRecord.size_bytes = stats.size;
      entryRecord.modified_at = stats.mtime.toISOString();
    }

    if (entry.isFile()) {
      try {
        entryRecord.preview = toPreviewText(readText(absolute), previewLines);
      } catch {
        entryRecord.preview = null;
      }
    }

    results.push(entryRecord);
    counter.count++;

    if (recursive && entry.isDirectory()) {
      results.push(
        ...listDirectoryEntries(rootPath, absolute, recursive, includeStats, previewLines, counter),
      );
    }
  }

  return results;
}

function inspectFiles(params: FilesInspectParams): ToolResultPayload {
  const rootPath = normalizeRoot(params.rootPath);
  const paths = params.paths.map((inputPath) => assertPathWithinRoot(rootPath, inputPath));
  const entries: Array<Record<string, unknown>> = [];

  for (const targetPath of paths) {
    if (!existsSync(targetPath)) {
      entries.push({
        path: relative(rootPath, targetPath),
        kind: "missing"
      });
      continue;
    }

    const stats = statSync(targetPath);
    const record: Record<string, unknown> = {
      path: relative(rootPath, targetPath),
      kind: stats.isDirectory() ? "directory" : "file"
    };

    if (params.includeStats ?? true) {
      record.size_bytes = stats.size;
      record.modified_at = stats.mtime.toISOString();
    }

    if (stats.isDirectory()) {
      record.entries = listDirectoryEntries(
        rootPath,
        targetPath,
        params.recursive ?? false,
        params.includeStats ?? true,
        params.previewLines ?? 12,
      );
    } else {
      try {
        record.preview = toPreviewText(readText(targetPath), params.previewLines ?? 12);
      } catch {
        record.preview = null;
      }
    }

    entries.push(record);
  }

  return success(
    `Inspected ${entries.length} path${entries.length === 1 ? "" : "s"}.`,
    { root_path: rootPath, entries },
  );
}

function readFile(params: FilesReadParams): ToolResultPayload {
  const rootPath = normalizeRoot(params.rootPath);
  const filePath = assertPathWithinRoot(rootPath, params.path);
  if (!existsSync(filePath)) {
    return failure("FILE_NOT_FOUND", `File not found: ${params.path}.`, "path");
  }
  const content = readText(filePath, params.encoding ?? "utf8");
  const stats = statSync(filePath);
  return success(
    `Read ${stats.size} bytes from ${relative(rootPath, filePath)}.`,
    {
      root_path: rootPath,
      path: relative(rootPath, filePath),
      encoding: params.encoding ?? "utf8",
      content,
      size_bytes: stats.size,
      modified_at: stats.mtime.toISOString()
    },
  );
}

function searchFiles(params: FilesSearchParams): ToolResultPayload {
  const rootPath = normalizeRoot(params.rootPath);
  const query = params.query.trim();
  if (!query) {
    return failure("INVALID_QUERY", "Search query must not be empty.", "query");
  }

  const matches: Array<Record<string, unknown>> = [];
  const stack = [rootPath];
  const needle = params.caseSensitive ? query : query.toLowerCase();

  while (stack.length) {
    const current = stack.pop()!;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolute = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolute);
        continue;
      }

      const relativePath = relative(rootPath, absolute);
      const haystackName = params.caseSensitive ? entry.name : entry.name.toLowerCase();
      if (haystackName.includes(needle)) {
        matches.push({
          path: relativePath,
          kind: "file",
          reason: "file_name"
        });
        continue;
      }

      if (params.includeContents !== false) {
        try {
          const fileSize = statSync(absolute).size;
          if (fileSize > MAX_FILE_SIZE) continue;
          const content = readText(absolute, "utf8");
          const haystack = params.caseSensitive ? content : content.toLowerCase();
          const index = haystack.indexOf(needle);
          if (index >= 0) {
            const snippetStart = Math.max(0, index - 40);
            const snippet = content.slice(snippetStart, index + needle.length + 80);
            matches.push({
              path: relativePath,
              kind: "file",
              reason: "file_content",
              snippet
            });
          }
        } catch {
          // Ignore unreadable or binary files in text search.
        }
      }

      if (matches.length >= (params.maxResults ?? 50)) {
        break;
      }
    }
    if (matches.length >= (params.maxResults ?? 50)) {
      break;
    }
  }

  return success(
    `Found ${matches.length} match${matches.length === 1 ? "" : "es"} for ${query}.`,
    {
      root_path: rootPath,
      query,
      matches
    },
  );
}

function writeFile(params: FilesWriteParams): ToolResultPayload {
  const approval = params.approvalId?.trim();
  if (!approval) {
    return approvalRequired("write", params.path);
  }
  const approvalRecord = getJarvisState().getApproval(approval);
  if (!approvalRecord || approvalRecord.state !== "approved") {
    return failure("INVALID_APPROVAL", `Approval "${approval}" is not valid or not in approved state.`, "approvalId");
  }

  const rootPath = normalizeRoot(params.rootPath);
  const filePath = assertPathWithinRoot(rootPath, params.path);
  if (existsSync(filePath) && params.overwrite === false) {
    return failure("FILE_EXISTS", `File already exists: ${params.path}.`, "path");
  }
  if (params.createDirectories !== false) {
    maybeCreateDirectory(filePath);
  }
  writeText(filePath, params.content, params.encoding ?? "utf8");
  const stats = statSync(filePath);
  return success(
    `Wrote ${stats.size} bytes to ${relative(rootPath, filePath)}.`,
    {
      root_path: rootPath,
      path: relative(rootPath, filePath),
      encoding: params.encoding ?? "utf8",
      size_bytes: stats.size
    },
  );
}

function patchFile(params: FilesPatchParams): ToolResultPayload {
  const approval = params.approvalId?.trim();
  if (!approval) {
    return approvalRequired("patch", params.path);
  }
  const approvalRecord = getJarvisState().getApproval(approval);
  if (!approvalRecord || approvalRecord.state !== "approved") {
    return failure("INVALID_APPROVAL", `Approval "${approval}" is not valid or not in approved state.`, "approvalId");
  }

  const rootPath = normalizeRoot(params.rootPath);
  const filePath = assertPathWithinRoot(rootPath, params.path);
  if (!existsSync(filePath)) {
    return failure("FILE_NOT_FOUND", `File not found: ${params.path}.`, "path");
  }
  if (params.createDirectories) {
    maybeCreateDirectory(filePath);
  }

  const original = readText(filePath, params.encoding ?? "utf8");
  let updated = original;
  let replacementCount = 0;

  for (const operation of params.operations) {
    const before = updated;
    if (operation.all) {
      const occurrences = before.split(operation.find).length - 1;
      replacementCount += Math.max(occurrences, 0);
      updated = before.split(operation.find).join(operation.replace);
    } else {
      const next = before.replace(operation.find, operation.replace);
      if (next !== before) {
        replacementCount += 1;
      }
      updated = next;
    }
  }

  writeText(filePath, updated, params.encoding ?? "utf8");
  return success(
    `Patched ${replacementCount} replacement${replacementCount === 1 ? "" : "s"} in ${relative(rootPath, filePath)}.`,
    {
      root_path: rootPath,
      path: relative(rootPath, filePath),
      replacement_count: replacementCount,
      before_preview: toPreviewText(original),
      after_preview: toPreviewText(updated)
    },
  );
}

function copyFile(params: FilesCopyParams): ToolResultPayload {
  const approval = params.approvalId?.trim();
  if (!approval) {
    return approvalRequired("copy", `${params.sourcePath} -> ${params.destinationPath}`);
  }
  const approvalRecord = getJarvisState().getApproval(approval);
  if (!approvalRecord || approvalRecord.state !== "approved") {
    return failure("INVALID_APPROVAL", `Approval "${approval}" is not valid or not in approved state.`, "approvalId");
  }

  const rootPath = normalizeRoot(params.rootPath);
  const sourcePath = assertPathWithinRoot(rootPath, params.sourcePath);
  const destinationPath = assertPathWithinRoot(rootPath, params.destinationPath);
  if (!existsSync(sourcePath)) {
    return failure("FILE_NOT_FOUND", `Source file not found: ${params.sourcePath}.`, "sourcePath");
  }
  if (existsSync(destinationPath) && !params.overwrite) {
    return failure(
      "FILE_EXISTS",
      `Destination already exists: ${params.destinationPath}.`,
      "destinationPath",
    );
  }
  if (params.createDirectories !== false) {
    maybeCreateDirectory(destinationPath);
  }
  copyFileSync(sourcePath, destinationPath);
  const stats = statSync(destinationPath);
  return success(
    `Copied ${relative(rootPath, sourcePath)} to ${relative(rootPath, destinationPath)}.`,
    {
      root_path: rootPath,
      source_path: relative(rootPath, sourcePath),
      destination_path: relative(rootPath, destinationPath),
      size_bytes: stats.size
    },
  );
}

function moveFile(params: FilesMoveParams): ToolResultPayload {
  const approval = params.approvalId?.trim();
  if (!approval) {
    return approvalRequired("move", `${params.sourcePath} -> ${params.destinationPath}`);
  }
  const approvalRecord = getJarvisState().getApproval(approval);
  if (!approvalRecord || approvalRecord.state !== "approved") {
    return failure("INVALID_APPROVAL", `Approval "${approval}" is not valid or not in approved state.`, "approvalId");
  }

  const rootPath = normalizeRoot(params.rootPath);
  const sourcePath = assertPathWithinRoot(rootPath, params.sourcePath);
  const destinationPath = assertPathWithinRoot(rootPath, params.destinationPath);
  if (!existsSync(sourcePath)) {
    return failure("FILE_NOT_FOUND", `Source file not found: ${params.sourcePath}.`, "sourcePath");
  }
  if (existsSync(destinationPath) && !params.overwrite) {
    return failure(
      "FILE_EXISTS",
      `Destination already exists: ${params.destinationPath}.`,
      "destinationPath",
    );
  }
  if (params.createDirectories !== false) {
    maybeCreateDirectory(destinationPath);
  }
  renameSync(sourcePath, destinationPath);
  return success(
    `Moved ${relative(rootPath, sourcePath)} to ${relative(rootPath, destinationPath)}.`,
    {
      root_path: rootPath,
      source_path: relative(rootPath, sourcePath),
      destination_path: relative(rootPath, destinationPath)
    },
  );
}

function previewFile(params: FilesPreviewParams): ToolResultPayload {
  const rootPath = normalizeRoot(params.rootPath);
  const filePath = assertPathWithinRoot(rootPath, params.path);
  if (!existsSync(filePath)) {
    return failure("FILE_NOT_FOUND", `File not found: ${params.path}.`, "path");
  }
  const content = readText(filePath, params.encoding ?? "utf8");
  const previewLines = params.maxLines ?? 12;
  const preview = toPreviewText(content, previewLines);
  const lineCount = content.split(/\r?\n/).length;
  return success(
    `Previewed ${relative(rootPath, filePath)} (${Math.min(previewLines, lineCount)} of ${lineCount} lines).`,
    {
      root_path: rootPath,
      path: relative(rootPath, filePath),
      encoding: params.encoding ?? "utf8",
      line_count: lineCount,
      preview
    },
  );
}

export function createFilesTools(): AnyAgentTool[] {
  return [
    createFilesTool(
      "files_inspect",
      "Files Inspect",
      "Inspect files or directories under an approved root.",
      Type.Object({
        rootPath: Type.Optional(Type.String({ minLength: 1 })),
        paths: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
        recursive: Type.Optional(Type.Boolean()),
        includeStats: Type.Optional(Type.Boolean()),
        previewLines: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 }))
      }),
      inspectFiles
    ),
    createFilesTool(
      "files_read",
      "Files Read",
      "Read a file under an approved root.",
      Type.Object({
        rootPath: Type.Optional(Type.String({ minLength: 1 })),
        path: Type.String({ minLength: 1 }),
        encoding: Type.Optional(encodingSchema)
      }),
      readFile
    ),
    createFilesTool(
      "files_search",
      "Files Search",
      "Search file names and content under an approved root.",
      Type.Object({
        rootPath: Type.Optional(Type.String({ minLength: 1 })),
        query: Type.String({ minLength: 1 }),
        caseSensitive: Type.Optional(Type.Boolean()),
        includeContents: Type.Optional(Type.Boolean()),
        maxResults: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 }))
      }),
      searchFiles
    ),
    createFilesTool(
      "files_write",
      "Files Write",
      "Write a file under an approved root.",
      Type.Object({
        rootPath: Type.Optional(Type.String({ minLength: 1 })),
        path: Type.String({ minLength: 1 }),
        content: Type.String(),
        encoding: Type.Optional(encodingSchema),
        createDirectories: Type.Optional(Type.Boolean()),
        overwrite: Type.Optional(Type.Boolean()),
        approvalId: Type.Optional(Type.String({ minLength: 1 }))
      }),
      writeFile
    ),
    createFilesTool(
      "files_patch",
      "Files Patch",
      "Apply deterministic text replacements to a file under an approved root.",
      Type.Object({
        rootPath: Type.Optional(Type.String({ minLength: 1 })),
        path: Type.String({ minLength: 1 }),
        operations: Type.Array(
          Type.Object({
            find: Type.String(),
            replace: Type.String(),
            all: Type.Optional(Type.Boolean())
          }),
          { minItems: 1 }
        ),
        encoding: Type.Optional(encodingSchema),
        createDirectories: Type.Optional(Type.Boolean()),
        approvalId: Type.Optional(Type.String({ minLength: 1 }))
      }),
      patchFile
    ),
    createFilesTool(
      "files_copy",
      "Files Copy",
      "Copy a file within an approved root.",
      Type.Object({
        rootPath: Type.Optional(Type.String({ minLength: 1 })),
        sourcePath: Type.String({ minLength: 1 }),
        destinationPath: Type.String({ minLength: 1 }),
        createDirectories: Type.Optional(Type.Boolean()),
        overwrite: Type.Optional(Type.Boolean()),
        approvalId: Type.Optional(Type.String({ minLength: 1 }))
      }),
      copyFile
    ),
    createFilesTool(
      "files_move",
      "Files Move",
      "Move a file within an approved root.",
      Type.Object({
        rootPath: Type.Optional(Type.String({ minLength: 1 })),
        sourcePath: Type.String({ minLength: 1 }),
        destinationPath: Type.String({ minLength: 1 }),
        createDirectories: Type.Optional(Type.Boolean()),
        overwrite: Type.Optional(Type.Boolean()),
        approvalId: Type.Optional(Type.String({ minLength: 1 }))
      }),
      moveFile
    ),
    createFilesTool(
      "files_preview",
      "Files Preview",
      "Preview the start of a file under an approved root.",
      Type.Object({
        rootPath: Type.Optional(Type.String({ minLength: 1 })),
        path: Type.String({ minLength: 1 }),
        maxLines: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
        encoding: Type.Optional(encodingSchema)
      }),
      previewFile
    )
  ];
}

function toToolContext(ctx: PluginCommandContext): OpenClawPluginToolContext {
  return {
    sessionKey: ctx.sessionKey,
    sessionId: ctx.sessionId,
    messageChannel: ctx.channel,
    requesterSenderId: ctx.senderId
  };
}

function parseJsonArgs<T>(ctx: PluginCommandContext): T | null {
  return safeJsonParse<T>(ctx.args);
}

function invalidJsonReply(commandName: string) {
  return toCommandReply(`Invalid JSON arguments for /${commandName}.`, true);
}

function missingJsonReply(commandName: string, usage: string) {
  return toCommandReply(`Usage: /${commandName} ${usage}`, true);
}

function replyFromResponse(response: ToolResultPayload) {
  const details = [response.summary];
  if (response.approval_id) {
    details.push(`approval=${response.approval_id}`);
  }
  return toCommandReply(details.join(" | "), response.status === "failed");
}

function runOperation(
  operation: FilesCommandArgs["operation"],
  args: FilesCommandArgs,
): ToolResultPayload {
  switch (operation) {
    case "inspect":
      return inspectFiles(args as FilesInspectParams);
    case "read":
      return readFile(args as FilesReadParams);
    case "search":
      return searchFiles(args as FilesSearchParams);
    case "write":
      return writeFile(args as FilesWriteParams);
    case "patch":
      return patchFile(args as FilesPatchParams);
    case "copy":
      return copyFile(args as FilesCopyParams);
    case "move":
      return moveFile(args as FilesMoveParams);
    case "preview":
      return previewFile(args as FilesPreviewParams);
    default:
      return failure("UNSUPPORTED_OPERATION", `Unsupported /files operation: ${operation}.`);
  }
}

export function createFilesCommand() {
  return {
    name: "files",
    description: "Run deterministic file broker operations from JSON arguments.",
    acceptsArgs: true,
    handler: (ctx: PluginCommandContext) => {
      const args = parseJsonArgs<FilesCommandArgs>(ctx);
      if (!args) {
        return invalidJsonReply("files");
      }

      switch (args.operation) {
        case "inspect":
          if (!args.paths?.length) {
            return missingJsonReply(
              "files",
              '{"operation":"inspect","paths":["notes.txt"]}'
            );
          }
          return replyFromResponse(runOperation("inspect", args));
        case "read":
          if (!args.path) {
            return missingJsonReply(
              "files",
              '{"operation":"read","path":"notes.txt"}'
            );
          }
          return replyFromResponse(runOperation("read", args));
        case "search":
          if (!args.query) {
            return missingJsonReply(
              "files",
              '{"operation":"search","query":"release"}'
            );
          }
          return replyFromResponse(runOperation("search", args));
        case "write":
          if (!args.path || typeof args.content !== "string") {
            return missingJsonReply(
              "files",
              '{"operation":"write","path":"notes.txt","content":"hello"}'
            );
          }
          return replyFromResponse(runOperation("write", args));
        case "patch":
          if (!args.path || !args.operations?.length) {
            return missingJsonReply(
              "files",
              '{"operation":"patch","path":"notes.txt","operations":[{"find":"old","replace":"new"}]}'
            );
          }
          return replyFromResponse(runOperation("patch", args));
        case "copy":
          if (!args.sourcePath || !args.destinationPath) {
            return missingJsonReply(
              "files",
              '{"operation":"copy","sourcePath":"a.txt","destinationPath":"b.txt"}'
            );
          }
          return replyFromResponse(runOperation("copy", args));
        case "move":
          if (!args.sourcePath || !args.destinationPath) {
            return missingJsonReply(
              "files",
              '{"operation":"move","sourcePath":"a.txt","destinationPath":"b.txt"}'
            );
          }
          return replyFromResponse(runOperation("move", args));
        case "preview":
          if (!args.path) {
            return missingJsonReply(
              "files",
              '{"operation":"preview","path":"notes.txt"}'
            );
          }
          return replyFromResponse(runOperation("preview", args));
        default:
          return toCommandReply(
            `Unsupported /files operation: ${String((args as { operation?: string }).operation)}`,
            true,
          );
      }
    }
  };
}

export const filesToolNames = [...FILES_TOOL_NAMES];
export const filesCommandNames = [...FILES_COMMAND_NAMES];

export default definePluginEntry({
  id: "jarvis-files",
  name: "Jarvis Files",
  description: "Safe file broker for deterministic local file operations",
  register(api) {
    api.registerTool(() => createFilesTools());
    api.registerCommand(createFilesCommand());
  }
});
