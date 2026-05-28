/// <reference types="@figma/plugin-typings" />
import { DetectionMode } from '../types';

export interface HeadingResult {
  text: string;
  warning?: string;
}

// Things that must never become a frame name: prices, discounts, CTAs.
const PRICING_PATTERNS: RegExp[] = [
  /[₹$€£¥]\s*[\d.,]+/, // ₹7,999  $19.99
  /\b\d[\d.,]*\s*(rs|inr|usd|eur|gbp|rupees?)\b/i, // 5999 INR
  /\bnow\s*@/i, // NOW @ ...
  /\b\d+\s*%\s*(off|discount)?/i, // 50% off
  /\b(flat|upto|up to|save)\b.*\d/i, // FLAT 50, UPTO ₹500
];

const CTA_PATTERNS: RegExp[] = [
  /^\s*(buy now|shop now|order now|book now|enroll now|join now|sign ?up|get started|learn more|apply now|register|subscribe|download|claim|grab|call now)\s*[!.]*\s*$/i,
];

function isPricing(text: string): boolean {
  return PRICING_PATTERNS.some((p) => p.test(text));
}

function isCTA(text: string): boolean {
  return CTA_PATTERNS.some((p) => p.test(text));
}

/** Max font size of a text node, handling mixed-size text without per-char scans. */
function maxFontSize(node: TextNode): number {
  const fs = node.fontSize;
  if (typeof fs === 'number') return fs;
  // Mixed: read styled segments once instead of looping char-by-char.
  try {
    const segs = node.getStyledTextSegments(['fontSize']);
    let max = 0;
    for (const seg of segs) if (seg.fontSize > max) max = seg.fontSize;
    return max;
  } catch {
    return 0;
  }
}

/** True if `node` is horizontally centered within `frame` (within a tolerance). */
function isHorizontallyCentered(node: TextNode, frame: SceneNode): boolean {
  const nb = node.absoluteBoundingBox;
  const fb = frame.absoluteBoundingBox;
  if (!nb || !fb || fb.width === 0) return false;
  const nodeCenter = nb.x + nb.width / 2;
  const frameCenter = fb.x + fb.width / 2;
  const offsetRatio = Math.abs(nodeCenter - frameCenter) / fb.width;
  return offsetRatio < 0.12; // within 12% of the frame's centre line
}

/** Vertical position 0..1 within the frame (0 = top). Lower is "higher up". */
function verticalRatio(node: TextNode, frame: SceneNode): number {
  const nb = node.absoluteBoundingBox;
  const fb = frame.absoluteBoundingBox;
  if (!nb || !fb || fb.height === 0) return 1;
  return Math.max(0, Math.min(1, (nb.y - fb.y) / fb.height));
}

function cleanText(t: string): string {
  return t.replace(/\s+/g, ' ').trim();
}

/**
 * Collect visible, non-empty text nodes inside a container.
 * Uses findAllWithCriteria (fast native traversal) and filters hidden subtrees.
 */
function collectTextNodes(frame: FrameNode | ComponentNode | InstanceNode): TextNode[] {
  let nodes: TextNode[];
  try {
    nodes = frame.findAllWithCriteria({ types: ['TEXT'] }) as TextNode[];
  } catch {
    nodes = frame.findAll((n) => n.type === 'TEXT') as TextNode[];
  }
  return nodes.filter((n) => n.visible && cleanText(n.characters).length > 0);
}

/**
 * Smart-score a text node as a heading candidate.
 * Larger fonts win; centered + near the top get a boost; short fragments and
 * ALL-CAPS one-worders are nudged down. Pricing / CTA already excluded.
 */
function score(node: TextNode, frame: SceneNode): number {
  const size = maxFontSize(node);
  let s = size; // dominant signal
  if (isHorizontallyCentered(node, frame)) s += size * 0.35;
  const v = verticalRatio(node, frame);
  if (v < 0.5) s += size * 0.15 * (1 - v); // upper half bonus
  const text = cleanText(node.characters);
  if (text.length < 3) s -= size * 0.5; // tiny fragments unlikely to be a title
  if (text.length > 60) s -= size * 0.1; // very long blocks slightly penalised
  return s;
}

/**
 * Detect the best "heading" text for a frame given a detection mode.
 * Falls back gracefully so a name is *always* produced.
 */
export function detectHeading(
  frame: FrameNode | ComponentNode | InstanceNode,
  mode: DetectionMode
): HeadingResult {
  const all = collectTextNodes(frame);
  if (all.length === 0) {
    return { text: frame.name, warning: 'No text layers — kept original name' };
  }

  // Strip pricing/CTA noise but keep a copy in case everything is noise.
  const meaningful = all.filter((n) => {
    const t = cleanText(n.characters);
    return !isPricing(t) && !isCTA(t);
  });
  const pool = meaningful.length > 0 ? meaningful : all;

  let chosen: TextNode;
  switch (mode) {
    case 'first':
      chosen = pool[0];
      break;
    case 'topmost':
      chosen = [...pool].sort((a, b) => verticalRatio(a, frame) - verticalRatio(b, frame))[0];
      break;
    case 'largest':
      chosen = [...pool].sort((a, b) => maxFontSize(b) - maxFontSize(a))[0];
      break;
    case 'smart':
    default:
      chosen = [...pool].sort((a, b) => score(b, frame) - score(a, frame))[0];
      break;
  }

  const text = cleanText(chosen.characters);
  if (!text) return { text: frame.name, warning: 'Detected text was empty — kept original name' };

  const warning = meaningful.length === 0 ? 'Only pricing/CTA text found' : undefined;
  return { text, warning };
}
