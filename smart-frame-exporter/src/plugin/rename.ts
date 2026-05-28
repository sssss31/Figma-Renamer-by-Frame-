/// <reference types="@figma/plugin-typings" />
import { DetectionMode, RenameEntry, RenameSummary, ProgressUpdate } from '../types';
import { detectHeading } from './headingDetection';
import { safeBaseName, dedupe } from './filenames';
import { ExportableNode } from './exportManager';

type Reporter = (u: ProgressUpdate) => void;

/**
 * Rename the given nodes directly on the canvas using their detected heading.
 *
 * The frame's `.name` is mutated, which is what makes the new name show up in
 * the Layers panel, on the canvas, and in subsequent export filenames. Names
 * are made filesystem-safe and de-duplicated across the whole batch.
 *
 * Yields to the event loop periodically so the UI thread stays responsive even
 * with 1000+ frames.
 */
export async function renameFrames(
  nodes: ExportableNode[],
  detection: DetectionMode,
  report: Reporter
): Promise<RenameSummary> {
  const total = nodes.length;
  const seen = new Map<string, number>();
  const entries: RenameEntry[] = [];
  let renamed = 0;
  let duplicatesFixed = 0;
  let warnings = 0;

  report({ stage: 'renaming', current: 0, total, message: 'Renaming frames…' });

  for (let i = 0; i < total; i++) {
    const node = nodes[i];
    const before = node.name;

    const detected = detectHeading(node, detection);
    const base = safeBaseName(detected.text);
    const { name, wasDuplicate } = dedupe(base, seen);

    // The actual on-canvas rename.
    node.name = name;

    if (name !== before) renamed++;
    if (wasDuplicate) duplicatesFixed++;
    if (detected.warning) warnings++;

    entries.push({
      id: node.id,
      before,
      after: name,
      detected: detected.text,
      wasDuplicate,
      warning: detected.warning,
    });

    // Throttle progress + yield so large batches never freeze the UI.
    if (i % 25 === 0 || i === total - 1) {
      report({
        stage: 'renaming',
        current: i + 1,
        total,
        message: `Renaming ${i + 1} / ${total} frames`,
      });
      await new Promise<void>((r) => setTimeout(r, 0));
    }
  }

  return { total, renamed, duplicatesFixed, warnings, entries };
}
