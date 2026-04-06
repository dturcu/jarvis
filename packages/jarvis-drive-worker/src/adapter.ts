import type {
  DriveListFilesInput,
  DriveListFilesOutput,
  DriveDownloadFileInput,
  DriveDownloadFileOutput,
  DriveWatchFolderInput,
  DriveWatchFolderOutput,
  DriveSyncFolderInput,
  DriveSyncFolderOutput,
} from "./types.js";

export type ExecutionOutcome<T> = {
  summary: string;
  structured_output: T;
};

export class DriveWorkerError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    retryable = false,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "DriveWorkerError";
    this.code = code;
    this.retryable = retryable;
    this.details = details;
  }
}

export interface DriveAdapter {
  listFiles(input: DriveListFilesInput): Promise<ExecutionOutcome<DriveListFilesOutput>>;
  downloadFile(input: DriveDownloadFileInput): Promise<ExecutionOutcome<DriveDownloadFileOutput>>;
  watchFolder(input: DriveWatchFolderInput): Promise<ExecutionOutcome<DriveWatchFolderOutput>>;
  syncFolder(input: DriveSyncFolderInput): Promise<ExecutionOutcome<DriveSyncFolderOutput>>;
}
