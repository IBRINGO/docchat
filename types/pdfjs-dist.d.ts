// pdfjs-dist ships no type declarations for its worker entry point (only for
// the main pdf.mjs, re-exported via pdf.d.mts). We only ever pass this
// module's default export straight through to `globalThis.pdfjsWorker` (see
// lib/pdf/extract.ts) without inspecting its shape, so an ambient `any` is
// the correct, minimal declaration — not a gap worth chasing further.
declare module "pdfjs-dist/legacy/build/pdf.worker.mjs";
