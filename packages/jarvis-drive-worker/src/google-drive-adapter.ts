import { google } from "googleapis";
import type { drive_v3 } from "googleapis";
import fs from "node:fs";
import path from "node:path";
import { DriveWorkerError, type DriveAdapter, type ExecutionOutcome } from "./adapter.js";
import type {
  DriveListFilesInput,
  DriveListFilesOutput,
  DriveDownloadFileInput,
  DriveDownloadFileOutput,
  DriveWatchFolderInput,
  DriveWatchFolderOutput,
  DriveSyncFolderInput,
  DriveSyncFolderOutput,
  DriveFile,
} from "./types.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function isRetryableDriveError(error: unknown): boolean {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code: number }).code;
    return code === 429 || code === 500 || code === 503;
  }
  return false;
}

function toDriveFile(file: drive_v3.Schema$File): DriveFile {
  return {
    id: file.id ?? "",
    name: file.name ?? "Untitled",
    mime_type: file.mimeType ?? "application/octet-stream",
    size: Number(file.size ?? 0),
    modified_at: file.modifiedTime ?? new Date().toISOString(),
    web_link: file.webViewLink ?? file.webContentLink ?? "",
  };
}

// ── GoogleDriveAdapter ───────────────────────────────────────────────────────

export type GoogleDriveAdapterConfig = {
  client_id: string;
  client_secret: string;
  refresh_token: string;
};

export class GoogleDriveAdapter implements DriveAdapter {
  private readonly drive: drive_v3.Drive;

  constructor(config: GoogleDriveAdapterConfig) {
    const oauth2 = new google.auth.OAuth2(
      config.client_id,
      config.client_secret,
    );
    oauth2.setCredentials({ refresh_token: config.refresh_token });
    this.drive = google.drive({ version: "v3", auth: oauth2 });
  }

  // ── listFiles ──────────────────────────────────────────────────────────────

  async listFiles(input: DriveListFilesInput): Promise<ExecutionOutcome<DriveListFilesOutput>> {
    try {
      const maxResults = input.max_results ?? 50;

      // Build query
      const queryParts: string[] = ["trashed = false"];
      if (input.folder_id) {
        queryParts.push(`'${input.folder_id}' in parents`);
      }
      if (input.query) {
        queryParts.push(`name contains '${input.query}'`);
      }

      const response = await this.drive.files.list({
        q: queryParts.join(" and "),
        pageSize: maxResults,
        fields: "files(id, name, mimeType, size, modifiedTime, webViewLink, webContentLink)",
        orderBy: "modifiedTime desc",
      });

      const files = (response.data.files ?? []).map(toDriveFile);

      return {
        summary: `Found ${files.length} file(s)${input.folder_id ? ` in folder ${input.folder_id}` : ""}.`,
        structured_output: {
          files,
          total: files.length,
          folder_id: input.folder_id,
        },
      };
    } catch (error) {
      throw this.wrapError("listFiles", error);
    }
  }

  // ── downloadFile ───────────────────────────────────────────────────────────

  async downloadFile(input: DriveDownloadFileInput): Promise<ExecutionOutcome<DriveDownloadFileOutput>> {
    try {
      // Ensure output directory exists
      const dir = path.dirname(input.output_path);
      fs.mkdirSync(dir, { recursive: true });

      const response = await this.drive.files.get(
        { fileId: input.file_id, alt: "media" },
        { responseType: "stream" },
      );

      return new Promise((resolve, reject) => {
        const dest = fs.createWriteStream(input.output_path);
        let size = 0;

        (response.data as NodeJS.ReadableStream)
          .on("data", (chunk: Buffer) => {
            size += chunk.length;
          })
          .on("end", () => {
            dest.end();
            resolve({
              summary: `Downloaded file ${input.file_id} (${formatBytes(size)}).`,
              structured_output: {
                file_id: input.file_id,
                output_path: input.output_path,
                size,
                downloaded_at: new Date().toISOString(),
              },
            });
          })
          .on("error", (err: Error) => {
            dest.end();
            reject(new DriveWorkerError(
              "DOWNLOAD_ERROR",
              `Failed to download file: ${err.message}`,
              true,
              { file_id: input.file_id },
            ));
          })
          .pipe(dest);
      });
    } catch (error) {
      if (this.isNotFoundError(error)) {
        throw new DriveWorkerError(
          "FILE_NOT_FOUND",
          `File ${input.file_id} not found.`,
          false,
          { file_id: input.file_id },
        );
      }
      throw this.wrapError("downloadFile", error);
    }
  }

  // ── watchFolder ────────────────────────────────────────────────────────────

  async watchFolder(input: DriveWatchFolderInput): Promise<ExecutionOutcome<DriveWatchFolderOutput>> {
    try {
      const queryParts = [
        `'${input.folder_id}' in parents`,
        "trashed = false",
      ];

      if (input.since) {
        queryParts.push(`modifiedTime > '${input.since}'`);
      }

      const response = await this.drive.files.list({
        q: queryParts.join(" and "),
        pageSize: 100,
        fields: "files(id, name, mimeType, size, modifiedTime, createdTime, webViewLink, webContentLink)",
        orderBy: "modifiedTime desc",
      });

      const allFiles = (response.data.files ?? []).map(toDriveFile);

      // Split into new vs modified based on creation time
      const newFiles: DriveFile[] = [];
      const modifiedFiles: DriveFile[] = [];

      for (const rawFile of response.data.files ?? []) {
        const file = toDriveFile(rawFile);
        const created = rawFile.createdTime ?? "";
        const modified = rawFile.modifiedTime ?? "";

        if (input.since && created > input.since) {
          newFiles.push(file);
        } else {
          modifiedFiles.push(file);
        }
      }

      return {
        summary: `Watched folder ${input.folder_id}: ${newFiles.length} new, ${modifiedFiles.length} modified file(s).`,
        structured_output: {
          new_files: newFiles,
          modified_files: modifiedFiles,
          checked_at: new Date().toISOString(),
        },
      };
    } catch (error) {
      throw this.wrapError("watchFolder", error);
    }
  }

  // ── syncFolder ─────────────────────────────────────────────────────────────

  async syncFolder(input: DriveSyncFolderInput): Promise<ExecutionOutcome<DriveSyncFolderOutput>> {
    try {
      // First, watch for changes
      const watchResult = await this.watchFolder({
        folder_id: input.folder_id,
        since: input.since,
      });

      const filesToDownload = [
        ...watchResult.structured_output.new_files,
        ...watchResult.structured_output.modified_files,
      ];

      // Ensure local directory exists
      fs.mkdirSync(input.local_path, { recursive: true });

      let downloaded = 0;
      let skipped = 0;
      let errors = 0;

      for (const file of filesToDownload) {
        // Skip Google Docs/Sheets/Slides (they have no direct download)
        if (file.mime_type.startsWith("application/vnd.google-apps.")) {
          skipped += 1;
          continue;
        }

        const outputPath = path.join(input.local_path, file.name);

        try {
          await this.downloadFile({ file_id: file.id, output_path: outputPath });
          downloaded += 1;
        } catch {
          errors += 1;
        }
      }

      return {
        summary: `Synced folder ${input.folder_id}: ${downloaded} downloaded, ${skipped} skipped, ${errors} errors.`,
        structured_output: {
          downloaded,
          skipped,
          errors,
          synced_at: new Date().toISOString(),
        },
      };
    } catch (error) {
      throw this.wrapError("syncFolder", error);
    }
  }

  // ── Error helpers ──────────────────────────────────────────────────────────

  private isNotFoundError(error: unknown): boolean {
    if (typeof error === "object" && error !== null && "code" in error) {
      return (error as { code: number }).code === 404;
    }
    return false;
  }

  private wrapError(operation: string, error: unknown): DriveWorkerError {
    if (error instanceof DriveWorkerError) return error;

    const retryable = isRetryableDriveError(error);
    const message = error instanceof Error
      ? error.message
      : `Google Drive API error during ${operation}.`;

    const details: Record<string, unknown> = { operation };
    if (typeof error === "object" && error !== null && "code" in error) {
      details["http_status"] = (error as { code: number }).code;
    }

    return new DriveWorkerError(
      "DRIVE_API_ERROR",
      message,
      retryable,
      details,
    );
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
