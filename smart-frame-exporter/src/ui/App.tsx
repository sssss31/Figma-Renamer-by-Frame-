import { useEffect, useRef, useState, useCallback } from 'react';
import JSZip from 'jszip';
import {
  PluginMessage,
  UIMessage,
  ProgressUpdate,
  RenameSummary,
  ExportSummary,
  ExportFormat,
  ExportScale,
  DetectionMode,
} from '../types';

// ─── Messaging helpers ──────────────────────────────────────────────────────
function send(msg: UIMessage) {
  parent.postMessage({ pluginMessage: msg }, '*');
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the download a tick before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

type Phase = 'idle' | 'renaming' | 'exporting' | 'zipping' | 'done';

export default function App() {
  const [selection, setSelection] = useState(0);
  const [format, setFormat] = useState<ExportFormat>('PNG');
  const [scale, setScale] = useState<ExportScale>(2);
  const [detection, setDetection] = useState<DetectionMode>('smart');

  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState<ProgressUpdate | null>(null);
  const [status, setStatus] = useState('Select frames on the canvas to begin.');
  const [renameSummary, setRenameSummary] = useState<RenameSummary | null>(null);
  const [exportSummary, setExportSummary] = useState<ExportSummary | null>(null);
  const [error, setError] = useState('');

  // The ZIP is built incrementally as bytes stream in from the plugin.
  const zipRef = useRef<JSZip | null>(null);

  const busy = phase === 'renaming' || phase === 'exporting' || phase === 'zipping';
  // Mirror `busy` into a ref so the mount-once message handler reads the
  // current value without needing to re-subscribe on every render.
  const busyRef = useRef(busy);
  busyRef.current = busy;

  // ─── Finalise ZIP once all files have streamed in ──────────────────────────
  const finishZip = useCallback(async (summary: ExportSummary, fmt: ExportFormat) => {
    const zip = zipRef.current;
    if (!zip) return;
    setPhase('zipping');
    setProgress({ stage: 'zipping', current: 0, total: 100, message: 'Generating ZIP…' });

    // PNG/JPG are already compressed, so STORE (no recompression) is far faster.
    // PDFs get light DEFLATE since they can shrink a little.
    const blob = await zip.generateAsync(
      {
        type: 'blob',
        compression: fmt === 'PDF' ? 'DEFLATE' : 'STORE',
        compressionOptions: { level: 1 },
        streamFiles: true,
      },
      (meta) => {
        setProgress({
          stage: 'zipping',
          current: Math.round(meta.percent),
          total: 100,
          message: `Generating ZIP… ${Math.round(meta.percent)}%`,
        });
      }
    );

    downloadBlob(blob, `frames-${fmt.toLowerCase()}-${Date.now()}.zip`);
    zipRef.current = null;
    setExportSummary(summary);
    setPhase('done');
    setProgress(null);
    const failNote = summary.failed > 0 ? ` · ${summary.failed} failed` : '';
    setStatus(`Done — ${summary.exported}/${summary.total} exported${failNote}. ZIP downloaded.`);
  }, []);

  // ─── Incoming messages from the plugin ─────────────────────────────────────
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data?.pluginMessage as PluginMessage | undefined;
      if (!msg) return;

      switch (msg.type) {
        case 'selection':
          setSelection(msg.count);
          if (!busyRef.current) {
            setStatus(
              msg.count === 0
                ? 'Select frames on the canvas to begin.'
                : `${msg.count} frame${msg.count === 1 ? '' : 's'} selected.`
            );
          }
          break;

        case 'progress':
          setProgress(msg.update);
          if (msg.update.message) setStatus(msg.update.message);
          break;

        case 'rename-done':
          setRenameSummary(msg.summary);
          setPhase('done');
          setProgress(null);
          setStatus(
            `Renamed ${msg.summary.renamed}/${msg.summary.total} frames` +
              (msg.summary.duplicatesFixed ? ` · ${msg.summary.duplicatesFixed} duplicate names fixed` : '')
          );
          break;

        case 'export-file': {
          // Add the streamed bytes straight into the ZIP.
          if (!zipRef.current) zipRef.current = new JSZip();
          zipRef.current.file(msg.filename, msg.bytes);
          break;
        }

        case 'export-done':
          void finishZip(msg.summary, msg.format);
          break;

        case 'error':
          setError(msg.message);
          setPhase('idle');
          setProgress(null);
          setStatus(msg.message);
          break;
      }
    };

    window.addEventListener('message', handler);
    send({ type: 'ui-ready' });
    return () => window.removeEventListener('message', handler);
    // Mount once: the handler reads live state via busyRef; finishZip is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Actions ───────────────────────────────────────────────────────────────
  const onRename = () => {
    setError('');
    setRenameSummary(null);
    setExportSummary(null);
    setPhase('renaming');
    setProgress({ stage: 'renaming', current: 0, total: selection, message: 'Renaming frames…' });
    send({ type: 'rename', detection });
  };

  const onExport = () => {
    setError('');
    setExportSummary(null);
    zipRef.current = new JSZip();
    setPhase('exporting');
    setProgress({ stage: 'exporting', current: 0, total: selection, message: 'Starting export…' });
    send({ type: 'export', settings: { format, scale, detection } });
  };

  const onCancel = () => {
    send({ type: 'cancel' });
    zipRef.current = null;
    setPhase('idle');
    setProgress(null);
    setStatus('Cancelled.');
  };

  // ─── Derived ───────────────────────────────────────────────────────────────
  const pct = progress
    ? progress.stage === 'zipping'
      ? progress.current
      : Math.round((progress.current / Math.max(progress.total, 1)) * 100)
    : 0;

  const disabled = selection === 0 || busy;

  // ─── Render ──────────────────────────────────────────────────────────────-─
  return (
    <div className="app">
      <header className="hdr">
        <div className="hdr-left">
          <span className="logo" aria-hidden>⚡</span>
          <h1>Smart Frame Exporter</h1>
        </div>
        <span className={`pill ${selection > 0 ? 'on' : ''}`}>
          {selection > 0 ? `${selection} selected` : 'none'}
        </span>
      </header>

      <main className="body">
        {/* ── Export settings ── */}
        <section className="card">
          <h2 className="card-title">Export settings</h2>

          <div className="field">
            <label>Format</label>
            <div className="seg">
              {(['PNG', 'JPG', 'PDF'] as ExportFormat[]).map((f) => (
                <button
                  key={f}
                  className={format === f ? 'seg-btn active' : 'seg-btn'}
                  onClick={() => setFormat(f)}
                  disabled={busy}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <label>Scale</label>
            <div className="seg">
              {([1, 2, 3] as ExportScale[]).map((s) => (
                <button
                  key={s}
                  className={scale === s ? 'seg-btn active' : 'seg-btn'}
                  onClick={() => setScale(s)}
                  disabled={busy || format === 'PDF'}
                  title={format === 'PDF' ? 'PDF ignores scale' : ''}
                >
                  {s}×
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <label>Heading detection</label>
            <select
              className="select"
              value={detection}
              onChange={(e) => setDetection(e.target.value as DetectionMode)}
              disabled={busy}
            >
              <option value="smart">Smart (largest + centered, skips prices)</option>
              <option value="largest">Largest text</option>
              <option value="topmost">Top-most text</option>
              <option value="first">First text layer</option>
            </select>
          </div>
        </section>

        {/* ── Progress ── */}
        {(busy || progress) && (
          <section className="card progress">
            <div className="bar">
              <div className="bar-fill" style={{ width: `${pct}%` }} />
            </div>
            <p className="status">{status}</p>
          </section>
        )}

        {/* ── Results ── */}
        {!busy && exportSummary && (
          <section className="card result">
            <div className="stats">
              <Stat n={exportSummary.total} label="selected" />
              <Stat n={exportSummary.exported} label="exported" tone="ok" />
              <Stat n={exportSummary.failed} label="failed" tone={exportSummary.failed ? 'bad' : undefined} />
            </div>
            {exportSummary.failed > 0 && (
              <details className="failures">
                <summary>{exportSummary.failed} failed file{exportSummary.failed === 1 ? '' : 's'}</summary>
                <ul>
                  {exportSummary.failedNames.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              </details>
            )}
          </section>
        )}

        {!busy && renameSummary && !exportSummary && (
          <section className="card result">
            <div className="stats">
              <Stat n={renameSummary.total} label="frames" />
              <Stat n={renameSummary.renamed} label="renamed" tone="ok" />
              <Stat n={renameSummary.duplicatesFixed} label="dupes fixed" />
            </div>
          </section>
        )}

        {error && !busy && <p className="error">{error}</p>}
      </main>

      <footer className="footer">
        {busy ? (
          <button className="btn ghost full" onClick={onCancel}>
            Cancel
          </button>
        ) : (
          <>
            <button className="btn secondary" onClick={onRename} disabled={disabled}>
              Rename Frames
            </button>
            <button className="btn primary" onClick={onExport} disabled={disabled}>
              Export {format}
            </button>
          </>
        )}
      </footer>
    </div>
  );
}

function Stat({ n, label, tone }: { n: number; label: string; tone?: 'ok' | 'bad' }) {
  return (
    <div className={`stat ${tone ?? ''}`}>
      <span className="stat-n">{n}</span>
      <span className="stat-l">{label}</span>
    </div>
  );
}
