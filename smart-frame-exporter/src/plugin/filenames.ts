// ─── Filename safety & de-duplication ──────────────────────────────────────

const INVALID_CHARS = /[\\/:*?"<>|\u0000-\u001F]/g;
const DEFAULT_MAX_LEN = 120;

/**
 * Turn arbitrary text into a filesystem-safe base name (no extension).
 * Removes \ / : * ? " < > | and control chars, collapses whitespace,
 * trims trailing dots/spaces (Windows-hostile), and clamps length.
 */
export function safeBaseName(raw: string, maxLen: number = DEFAULT_MAX_LEN): string {
  let s = (raw || '').replace(INVALID_CHARS, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  // Windows forbids trailing dot/space on a name.
  s = s.replace(/[. ]+$/g, '').trim();
  if (s.length > maxLen) s = s.slice(0, maxLen).trim();
  if (!s) s = 'Untitled';
  return s;
}

/**
 * Ensures every name in a sequence is unique by appending -1, -2, … to
 * collisions. Returns the resolved name plus whether a suffix was added.
 * `seen` is shared mutable state so it works across a whole batch.
 */
export function dedupe(base: string, seen: Map<string, number>): { name: string; wasDuplicate: boolean } {
  const used = seen.get(base);
  if (used === undefined) {
    seen.set(base, 0);
    return { name: base, wasDuplicate: false };
  }
  // Find the next free "base-N".
  let n = used + 1;
  let candidate = `${base}-${n}`;
  while (seen.has(candidate)) {
    n += 1;
    candidate = `${base}-${n}`;
  }
  seen.set(base, n);
  seen.set(candidate, 0);
  return { name: candidate, wasDuplicate: true };
}

export function extensionFor(format: 'PNG' | 'JPG' | 'PDF'): string {
  return format.toLowerCase();
}
