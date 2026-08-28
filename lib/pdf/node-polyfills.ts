import CSSMatrix from "@thednp/dommatrix";

/**
 * Root cause of the Vercel production crash (`ReferenceError: DOMMatrix is
 * not defined`, thrown during module evaluation, before the upload handler
 * ever runs):
 *
 * pdfjs-dist's Node ("legacy") build unconditionally evaluates its
 * canvas-RENDERING module code (`src/display/canvas.js`) as part of loading
 * `pdfjs-dist/legacy/build/pdf.mjs` — even though this app only ever calls
 * `page.getTextContent()` (see lib/pdf/extract.ts), never `page.render()`.
 * That module has a top-level `const SCALE_MATRIX = new DOMMatrix();`, which
 * runs the instant the module is imported, regardless of whether rendering
 * is ever used.
 *
 * `DOMMatrix` isn't a real Node.js global. pdfjs-dist tries to self-polyfill
 * it (`src/display/node_utils.js`) from its OPTIONAL `@napi-rs/canvas`
 * dependency — a native binary package published per-platform. Locally, npm
 * installed the Windows-native binary, so that self-polyfill silently
 * succeeds and this file's own polyfill below is a no-op. On Vercel's Linux
 * serverless runtime, the matching native binary either isn't present or
 * fails to load — a well-known limitation of native optional dependencies
 * under Vercel's dependency-tracing/bundling for Next.js — so pdfjs-dist's
 * `require("@napi-rs/canvas")` throws, it just logs a warning and leaves
 * `globalThis.DOMMatrix` unset, and the later top-level `new DOMMatrix()`
 * throws instead.
 *
 * The fix: define `globalThis.DOMMatrix` ourselves, before pdfjs-dist's
 * module body ever runs (see the import order in lib/pdf/extract.ts, which
 * is what actually guarantees "before" — ESM evaluates static imports
 * depth-first in source order), using `@thednp/dommatrix`'s `CSSMatrix` — a
 * small, dependency-free, pure-JS, DOMMatrix-API-compatible class (the
 * maintained successor to the now-deprecated `dommatrix` package). Being
 * pure JS rather than a native binary, it works identically on every
 * platform/runtime, which is exactly the property the native package
 * lacked. It does not implement every method of the real browser
 * `DOMMatrix` (e.g. `invertSelf`, `preMultiplySelf`) — only enough for
 * pdf.js's module-evaluation-time code to finish loading without crashing.
 * That's sufficient here because this app's extraction path never calls
 * pdf.js's actual canvas-rendering functions (the only place those missing
 * methods would be invoked) — see README, "Production-safe PDF extraction."
 */
if (typeof globalThis.DOMMatrix === "undefined") {
  globalThis.DOMMatrix = CSSMatrix as unknown as typeof DOMMatrix;
}
