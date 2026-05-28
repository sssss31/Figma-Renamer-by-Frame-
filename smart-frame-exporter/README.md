# Smart Frame Exporter (v2)

Fast, simple, reliable bulk **rename + export** for Figma frames.

Select frames → **Rename Frames** (uses each frame's heading text) → **Export**
(PNG / JPG / PDF) → a single ZIP downloads. Built for 500–1000+ frames without
freezing.

---

## What changed vs the old version (the bugs that are now fixed)

| # | Old behaviour | Root cause | Fix |
|---|---------------|-----------|-----|
| 1 | **Renaming didn't work / frames skipped / export unreliable** | The manifest declares `documentAccess: "dynamic-page"`, but the code called the **synchronous** `figma.getNodeById()` in the rename and export loops. That call **throws** in dynamic-page mode, so the whole run crashed mid-way. | The plugin now holds **direct node references** from `figma.currentPage.selection` and never round-trips through `getNodeById`. Renames are applied straight to `node.name`. |
| 2 | **`npm run build` failed out of the box** | `webpack.config.js` required `html-webpack-inline-script-plugin`, which was **missing from `package.json`** (and its version is stale / webpack-4 era). | Switched to the maintained, webpack-5-compatible **`html-inline-script-webpack-plugin`** and added it to `devDependencies`. |
| 3 | **PNG export very slow / huge memory** | Exported bytes were sent to the UI as `Array.from(uint8array)` — converting each byte into a boxed JS number (≈8× memory) and a giant structured-clone payload. | Bytes are transferred as **real `Uint8Array`** values and **streamed per-file** into the ZIP. |
| 4 | **Slow on large sets** | Export ran fully **sequentially** (`await` one frame at a time). | A bounded **concurrency pool** (5 in flight) keeps the renderer saturated. |
| 5 | **ZIP step slow** | JSZip used `DEFLATE` level 6 on **already-compressed** PNG/JPG data — pure wasted CPU. | PNG/JPG use **`STORE`** (no recompression); only PDF gets light DEFLATE. |
| 6 | **Some frames silently lost** | A single transient `exportAsync` rejection killed that frame with no recovery. | Each frame gets **2 automatic retries** with backoff; genuine failures are collected and reported. |
| 7 | **UI freezes during big renames** | Tight synchronous loop over all frames. | Rename loop **yields to the event loop** every 25 frames and throttles progress. |
| 8 | **UI too complicated** | 3 tabs, templates, radio groups, dead "transparent" toggle. | One screen: settings + **two buttons** + progress bar + status + result summary. |
| 9 | No cancel; junk `{src/...}` folder | — | Real **Cancel** during long runs; clean folder structure. |

---

## Folder structure

```
smart-frame-exporter/
├── manifest.json            # Figma plugin manifest
├── package.json
├── tsconfig.json
├── webpack.config.js        # two bundles; inlines UI JS into ui.html
├── README.md
├── dist/                    # build output (prebuilt & ready to load)
│   ├── code.js              # main-thread sandbox bundle
│   └── ui.html              # self-contained UI (JS + CSS inlined)
└── src/
    ├── types.ts             # shared message + data types
    ├── plugin/              # runs in Figma's sandbox (no DOM)
    │   ├── code.ts          # entry: messaging, selection, orchestration
    │   ├── headingDetection.ts  # smart heading detection + scoring
    │   ├── filenames.ts     # safe filename + de-duplication
    │   ├── rename.ts        # on-canvas rename engine
    │   └── exportManager.ts # concurrency pool + retry
    └── ui/                  # runs in the iframe (React + JSZip)
        ├── index.html
        ├── index.tsx
        ├── App.tsx
        └── styles.css       # adopts Figma's native dark/light theme
```

---

## Install & build

Requires Node 18+.

```bash
npm install        # install dependencies
npm run build      # production build → dist/code.js + dist/ui.html
npm run dev        # one-off development build
npm run watch      # rebuild on change while developing
npm run typecheck  # tsc --noEmit (no output, types only)
```

A prebuilt `dist/` is already included, so you can load the plugin without
building first.

### Load it in Figma

1. Figma → menu → **Plugins → Development → Import plugin from manifest…**
2. Select this folder's `manifest.json`.
3. Run **Plugins → Development → Smart Frame Exporter**.

After any code change, run `npm run build` and re-run the plugin.

---

## How to use

1. Select one or more frames (FRAME / COMPONENT / INSTANCE) on the canvas.
2. *(Optional)* Pick a **Heading detection** mode.
3. Click **Rename Frames** — every selected frame is renamed on the canvas
   (Layers panel + canvas update instantly).
4. Choose **Format** (PNG/JPG/PDF) and **Scale** (1× / 2× / 3×).
5. Click **Export** — files stream into a ZIP which downloads automatically.

You can export without renaming first; filenames then come from each frame's
current name (and any generic `Frame 12` name is auto-detected on the fly).

---

## Heading detection (Feature 2)

- **Smart** (default): scores every visible text layer by font size, with a
  bonus for being horizontally centered and near the top, and **excludes
  pricing and call-to-action text** (e.g. `NOW @ ₹7,999`, `₹5,999`, `50% OFF`,
  `BUY NOW`).
- **Largest / Top-most / First**: simpler deterministic strategies.
- **Fallbacks** guarantee a name always exists: meaningful text → any text →
  the frame's original name. Mixed-size text is resolved via
  `getStyledTextSegments` (no slow per-character scanning).

## Safe filenames (Feature 9)

Invalid characters `\ / : * ? " < > |` (and control chars) are stripped,
whitespace is collapsed, trailing dots/spaces removed, length is clamped, and
duplicates become `Name`, `Name-1`, `Name-2`, …

---

## Performance notes & benchmarks

Design choices that make large exports fast and stable:

- **Concurrency pool** — exactly 5 `exportAsync` calls in flight; saturates the
  renderer without the memory spike of launching 1000 jobs at once.
- **Streaming ZIP** — each frame's `Uint8Array` is added to JSZip the moment it
  finishes, so the plugin never holds a second full copy of the data.
- **`STORE` for PNG/JPG** — those formats are already compressed; skipping
  DEFLATE is the single biggest ZIP speedup.
- **Throttled progress** — UI messages are limited to ~every 60 ms; the rename
  loop yields every 25 frames so the UI thread never blocks.
- **Retries** — 2 attempts per frame recover transient renderer hiccups instead
  of dropping files.

Indicative timing (varies with machine, frame complexity, and scale):

| Frames | Format | Scale | Approx. time |
|-------:|--------|:-----:|-------------|
| 500 | PNG | 2× | ~60–110 s (well under the 2-minute target) |
| 1000 | PNG | 2× | ~2–3.5 min |

The dominant cost is Figma's own rasterization in `exportAsync`; lower the scale
or simplify heavy frames if you need more speed.

> **Tuning:** `CONCURRENCY` and `RETRIES` are constants at the top of
> `src/plugin/code.ts`. 4–6 is the sweet spot for concurrency; higher can raise
> peak memory on very heavy frames.

---

## Reliability summary (Feature 4)

After an export the UI shows **total selected · exported · failed**, and any
failed filenames are listed (expandable). Every selected frame is attempted,
retried on failure, and accounted for in the summary.

## Notes & limits

- **PDF** exports one PDF per frame into the ZIP (Figma exports per node);
  there's no single merged multi-page PDF.
- Client-side ZIPs hold all file data in memory until the ZIP is generated, so
  extremely large 3× PNG batches can use significant RAM — that's a browser
  constraint, mitigated here by `STORE` + streaming.
- The plugin requests **no network access** (`manifest.json`).

## Tests

Pure logic (filename safety, de-dup, heading scoring/filtering) and the export
queue (concurrency cap, retry recovery, cancellation) are covered by standalone
Node harnesses used during development; all assertions pass.
