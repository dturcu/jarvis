// ── drive.list_files ─────────────────────────────────────────────────────────

export type DriveListFilesInput = {
  folder_id?: string;
  query?: string;
  max_results?: number;
};

export type DriveFile = {
  id: string;
  name: string;
  mime_type: string;
  size: number;
  modified_at: string;
  web_link: string;
};

export type DriveListFilesOutput = {
  files: DriveFile[];
  total: number;
  folder_id?: string;
};

// ── drive.download_file ──────────────────────────────────────────────────────

export type DriveDownloadFileInput = {
  file_id: string;
  output_path: string;
};

export type DriveDownloadFileOutput = {
  file_id: string;
  output_path: string;
  size: number;
  downloaded_at: string;
};

// ── drive.watch_folder ───────────────────────────────────────────────────────

export type DriveWatchFolderInput = {
  folder_id: string;
  since?: string;
};

export type DriveWatchFolderOutput = {
  new_files: DriveFile[];
  modified_files: DriveFile[];
  checked_at: string;
};

// ── drive.sync_folder ────────────────────────────────────────────────────────

export type DriveSyncFolderInput = {
  folder_id: string;
  local_path: string;
  since?: string;
};

export type DriveSyncFolderOutput = {
  downloaded: number;
  skipped: number;
  errors: number;
  synced_at: string;
};
