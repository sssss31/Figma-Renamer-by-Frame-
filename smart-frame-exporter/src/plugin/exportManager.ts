/// <reference types="@figma/plugin-typings" />
import { ExportFormat, ExportScale } from '../types';

export type ExportableNode = FrameNode | ComponentNode | InstanceNode;

export interface ExportTask {
  node: ExportableNode;
  filename: string; // already safe + unique, includes extension
}

export interface ExportOutcome {
  filename: string;
  bytes: Uint8Array | null;
  error?: string;
}

interface RunOptions {
  format: ExportFormat;
  scale: ExportScale;
  concurrency: number;
  retries: number;
  /** Called once per finished task (success or final failure). */
  onResult: (outcome: ExportOutcome, completed: number, total: number) => void;
  /** Return true to abort the queue early. */
  isCancelled: () => boolean;
}

function buildExportSettings(format: ExportFormat, scale: ExportScale): ExportSettings {
  if (format === 'PDF') {
    // PDF ignores scale constraints.
    return { format: 'PDF' };
  }
  return {
    format,
    constraint: { type: 'SCALE', value: scale },
  } as ExportSettings;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function exportOne(
  task: ExportTask,
  settings: ExportSettings,
  retries: number
): Promise<ExportOutcome> {
  let lastErr = '';
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const bytes = await task.node.exportAsync(settings);
      return { filename: task.filename, bytes };
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      if (attempt < retries) {
        await sleep(120 * (attempt + 1)); // small backoff before retrying
      }
    }
  }
  return { filename: task.filename, bytes: null, error: lastErr };
}

/**
 * Export a list of tasks using a bounded concurrency pool.
 *
 * A fixed number of "workers" pull tasks off a shared cursor, so exactly
 * `concurrency` exportAsync calls are ever in flight. This keeps the renderer
 * busy (fast) without spawning 1000 simultaneous jobs (which would spike
 * memory and freeze Figma). Each finished task is reported immediately via
 * `onResult` so the UI can stream bytes into the ZIP and update progress.
 */
export async function runExportQueue(tasks: ExportTask[], opts: RunOptions): Promise<void> {
  const settings = buildExportSettings(opts.format, opts.scale);
  const total = tasks.length;
  let cursor = 0;
  let completed = 0;
  const workers = Math.max(1, Math.min(opts.concurrency, total));

  async function worker() {
    while (true) {
      if (opts.isCancelled()) return;
      const index = cursor++;
      if (index >= total) return;
      const outcome = await exportOne(tasks[index], settings, opts.retries);
      completed += 1;
      opts.onResult(outcome, completed, total);
    }
  }

  const pool: Promise<void>[] = [];
  for (let i = 0; i < workers; i++) pool.push(worker());
  await Promise.all(pool);
}
