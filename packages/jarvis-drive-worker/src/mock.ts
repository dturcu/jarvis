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

const MOCK_NOW = "2026-04-06T12:00:00.000Z";

const MOCK_FILES: DriveFile[] = [
  {
    id: "drive-001",
    name: "ISO_26262_HARA_BrakeECU_v2.docx",
    mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    size: 2457600,
    modified_at: "2026-04-05T14:30:00.000Z",
    web_link: "https://docs.google.com/document/d/drive-001",
  },
  {
    id: "drive-002",
    name: "AutomoTech_Proposal_Q2-2026.pdf",
    mime_type: "application/pdf",
    size: 1843200,
    modified_at: "2026-04-04T09:15:00.000Z",
    web_link: "https://drive.google.com/file/d/drive-002",
  },
  {
    id: "drive-003",
    name: "TIC_Safety_Case_Template.docx",
    mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    size: 512000,
    modified_at: "2026-04-03T16:45:00.000Z",
    web_link: "https://docs.google.com/document/d/drive-003",
  },
  {
    id: "drive-004",
    name: "AUTOSAR_Migration_Timeline.xlsx",
    mime_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    size: 307200,
    modified_at: "2026-04-02T11:00:00.000Z",
    web_link: "https://docs.google.com/spreadsheets/d/drive-004",
  },
  {
    id: "drive-005",
    name: "Meeting_Notes_20260401.pdf",
    mime_type: "application/pdf",
    size: 204800,
    modified_at: "2026-04-01T18:20:00.000Z",
    web_link: "https://drive.google.com/file/d/drive-005",
  },
];

export class MockDriveAdapter implements DriveAdapter {
  private files: DriveFile[] = MOCK_FILES.map(f => ({ ...f }));
  private downloadCount = 0;

  getFileCount(): number {
    return this.files.length;
  }

  getDownloadCount(): number {
    return this.downloadCount;
  }

  async listFiles(input: DriveListFilesInput): Promise<ExecutionOutcome<DriveListFilesOutput>> {
    const maxResults = input.max_results ?? 50;

    let filtered = [...this.files];

    if (input.query) {
      const q = input.query.toLowerCase();
      filtered = filtered.filter(f => f.name.toLowerCase().includes(q));
    }

    // In mock, folder_id just filters to first N files
    const result = filtered.slice(0, maxResults);

    return {
      summary: `Found ${result.length} file(s)${input.folder_id ? ` in folder ${input.folder_id}` : ""}.`,
      structured_output: {
        files: result,
        total: result.length,
        folder_id: input.folder_id,
      },
    };
  }

  async downloadFile(input: DriveDownloadFileInput): Promise<ExecutionOutcome<DriveDownloadFileOutput>> {
    const file = this.files.find(f => f.id === input.file_id);
    if (!file) {
      throw new DriveWorkerError(
        "FILE_NOT_FOUND",
        `File ${input.file_id} not found.`,
        false,
        { file_id: input.file_id },
      );
    }

    this.downloadCount += 1;

    return {
      summary: `Downloaded file "${file.name}" (${formatBytes(file.size)}).`,
      structured_output: {
        file_id: input.file_id,
        output_path: input.output_path,
        size: file.size,
        downloaded_at: MOCK_NOW,
      },
    };
  }

  async watchFolder(input: DriveWatchFolderInput): Promise<ExecutionOutcome<DriveWatchFolderOutput>> {
    const newFiles: DriveFile[] = [];
    const modifiedFiles: DriveFile[] = [];

    for (const file of this.files) {
      if (input.since && file.modified_at > input.since) {
        // Treat the most recent as "new", rest as "modified"
        if (newFiles.length < 1) {
          newFiles.push(file);
        } else {
          modifiedFiles.push(file);
        }
      }
    }

    return {
      summary: `Watched folder ${input.folder_id}: ${newFiles.length} new, ${modifiedFiles.length} modified file(s).`,
      structured_output: {
        new_files: newFiles,
        modified_files: modifiedFiles,
        checked_at: MOCK_NOW,
      },
    };
  }

  async syncFolder(input: DriveSyncFolderInput): Promise<ExecutionOutcome<DriveSyncFolderOutput>> {
    const watchResult = await this.watchFolder({
      folder_id: input.folder_id,
      since: input.since,
    });

    const total = watchResult.structured_output.new_files.length +
      watchResult.structured_output.modified_files.length;

    return {
      summary: `Synced folder ${input.folder_id}: ${total} downloaded, 0 skipped, 0 errors.`,
      structured_output: {
        downloaded: total,
        skipped: 0,
        errors: 0,
        synced_at: MOCK_NOW,
      },
    };
  }
}

export function createMockDriveAdapter(): DriveAdapter {
  return new MockDriveAdapter();
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
