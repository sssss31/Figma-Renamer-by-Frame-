// ─── Shared types between the plugin sandbox and the UI iframe ─────────────

export type ExportFormat = 'PNG' | 'JPG' | 'PDF';
export type ExportScale = 1 | 2 | 3;

/** How the "heading" used for a frame's name is chosen. */
export type DetectionMode = 'smart' | 'largest' | 'topmost' | 'first';

export interface ExportSettingsUI {
  format: ExportFormat;
  scale: ExportScale;
  detection: DetectionMode;
}

/** One frame as renamed, reported back to the UI. */
export interface RenameEntry {
  id: string;
  before: string;
  after: string;
  detected: string;
  wasDuplicate: boolean;
  warning?: string;
}

export interface RenameSummary {
  total: number;
  renamed: number;
  duplicatesFixed: number;
  warnings: number;
  entries: RenameEntry[];
}

export interface ExportSummary {
  total: number;
  exported: number;
  failed: number;
  failedNames: string[];
}

export type ProgressStage =
  | 'scanning'
  | 'renaming'
  | 'exporting'
  | 'zipping'
  | 'done'
  | 'error'
  | 'idle';

export interface ProgressUpdate {
  stage: ProgressStage;
  current: number;
  total: number;
  message: string;
}

// ── UI → Plugin ────────────────────────────────────────────────────────────
export type UIMessage =
  | { type: 'ui-ready' }
  | { type: 'rename'; detection: DetectionMode }
  | { type: 'export'; settings: ExportSettingsUI }
  | { type: 'cancel' }
  | { type: 'close' };

// ── Plugin → UI ──────────────────────────────────────────────────────────-─
export type PluginMessage =
  | { type: 'selection'; count: number }
  | { type: 'progress'; update: ProgressUpdate }
  | { type: 'rename-done'; summary: RenameSummary }
  // A single exported file, streamed so the UI can add it to the ZIP
  // incrementally (keeps peak memory bounded). `bytes` is a real Uint8Array
  // transferred via structured clone — never an Array of numbers.
  | { type: 'export-file'; filename: string; bytes: Uint8Array; index: number; total: number }
  | { type: 'export-done'; summary: ExportSummary; format: ExportFormat }
  | { type: 'error'; message: string };
