/// <reference types="@figma/plugin-typings" />
import {
  UIMessage,
  PluginMessage,
  ProgressUpdate,
  ExportSummary,
} from '../types';
import { renameFrames } from './rename';
import { detectHeading } from './headingDetection';
import { safeBaseName, dedupe, extensionFor } from './filenames';
import { runExportQueue, ExportableNode, ExportTask } from './exportManager';

// ─── Tuning ────────────────────────────────────────────────────────────────
const CONCURRENCY = 5; // simultaneous exportAsync calls
const RETRIES = 2; // extra attempts per frame on failure

// ─── Boot ───────────────────────────────────────────────────────────────────
figma.showUI(__html__, { width: 360, height: 560, themeColors: true });

let cancelled = false;

// ─── Helpers ──────────────────────────────────────────────────────────────-
function post(msg: PluginMessage) {
  figma.ui.postMessage(msg);
}

function progress(u: ProgressUpdate) {
  post({ type: 'progress', update: u });
}

function isExportable(n: SceneNode): n is ExportableNode {
  return n.type === 'FRAME' || n.type === 'COMPONENT' || n.type === 'INSTANCE';
}

/** Selected, exportable container nodes on the current page. */
function getSelectedFrames(): ExportableNode[] {
  return figma.currentPage.selection.filter(isExportable);
}

function reportSelection() {
  post({ type: 'selection', count: getSelectedFrames().length });
}

// ─── Export orchestration ───────────────────────────────────────────────────
async function doExport(format: 'PNG' | 'JPG' | 'PDF', scale: 1 | 2 | 3) {
  cancelled = false;
  const frames = getSelectedFrames();

  if (frames.length === 0) {
    post({ type: 'error', message: 'No frames selected. Select frames on the canvas first.' });
    return;
  }

  // Build safe, unique filenames from each frame's CURRENT name (which already
  // reflects any rename the user ran). If a frame still has a generic name we
  // detect a heading on the fly so nothing exports as "Frame 12".
  progress({ stage: 'scanning', current: 0, total: frames.length, message: 'Preparing files…' });
  const ext = extensionFor(format);
  const seen = new Map<string, number>();
  const tasks: ExportTask[] = frames.map((node) => {
    let base = node.name;
    if (!base.trim() || /^(frame|group|component|instance)\s+\d+$/i.test(base.trim())) {
      base = detectHeading(node, 'smart').text;
    }
    const safe = safeBaseName(base);
    const { name } = dedupe(safe, seen);
    return { node, filename: `${name}.${ext}` };
  });

  const summary: ExportSummary = { total: tasks.length, exported: 0, failed: 0, failedNames: [] };

  progress({ stage: 'exporting', current: 0, total: tasks.length, message: `Exporting 0 / ${tasks.length}` });

  let lastTick = 0;
  await runExportQueue(tasks, {
    format,
    scale,
    concurrency: CONCURRENCY,
    retries: RETRIES,
    isCancelled: () => cancelled,
    onResult: (outcome, completed, total) => {
      if (outcome.bytes) {
        summary.exported++;
        // Stream the real Uint8Array straight to the UI (no Array.from bloat).
        post({
          type: 'export-file',
          filename: outcome.filename,
          bytes: outcome.bytes,
          index: completed,
          total,
        });
      } else {
        summary.failed++;
        summary.failedNames.push(outcome.filename);
      }
      // Throttle progress messages to ~every 60ms (plus the final one).
      const now = Date.now();
      if (now - lastTick > 60 || completed === total) {
        lastTick = now;
        progress({
          stage: 'exporting',
          current: completed,
          total,
          message: `Exporting ${completed} / ${total}`,
        });
      }
    },
  });

  if (cancelled) {
    progress({ stage: 'idle', current: 0, total: 0, message: 'Export cancelled.' });
    return;
  }

  post({ type: 'export-done', summary, format });
}

// ─── Message routing ────────────────────────────────────────────────────────
figma.ui.onmessage = async (msg: UIMessage) => {
  try {
    switch (msg.type) {
      case 'ui-ready':
        reportSelection();
        break;

      case 'rename': {
        const frames = getSelectedFrames();
        if (frames.length === 0) {
          post({ type: 'error', message: 'No frames selected. Select frames on the canvas first.' });
          return;
        }
        const summary = await renameFrames(frames, msg.detection, progress);
        post({ type: 'rename-done', summary });
        progress({ stage: 'idle', current: summary.total, total: summary.total, message: 'Rename complete.' });
        break;
      }

      case 'export':
        await doExport(msg.settings.format, msg.settings.scale);
        break;

      case 'cancel':
        cancelled = true;
        break;

      case 'close':
        figma.closePlugin();
        break;
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    post({ type: 'error', message });
  }
};

// Keep the selection badge live as the user clicks around the canvas.
figma.on('selectionchange', reportSelection);
