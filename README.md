# DocChat - Smartly.ai Technical Test

## Description
DocChat is a full-stack application that allows users to upload PDF documents and ask natural language questions about their content using RAG (Retrieval-Augmented Generation).

## Architecture

### Tech Stack
- **Frontend**: Next.js 16 App Router (React 19, TypeScript, Tailwind CSS 4)
- **Backend**: Next.js API Routes (Node.js runtime, streaming via the Web Streams API)
- **Database**: MongoDB Atlas (documents + chunks, Atlas Vector Search for retrieval)
- **Embeddings**: Gemini (`gemini-embedding-2`, primary) / OpenAI (`text-embedding-3-small`, fallback)
- **Answer generation**: Gemini (`gemini-3.6-flash`, primary) / OpenAI (`gpt-4o-mini`, fallback)
- **Deployment target**: Vercel (not yet deployed — see Vercel readiness below)

No LangChain/LlamaIndex — see [Why not LangChain/LlamaIndex](#why-not-langchainllamaindex).

### Project Structure
```
docchat/
├── app/                      # Next.js App Router
│   ├── api/upload/           # PDF upload + ingestion endpoint
│   ├── api/chat/             # Retrieval + grounded streaming chat endpoint
│   ├── layout.tsx
│   └── page.tsx              # Upload → processing → chat client page
├── components/
│   ├── upload/                # UploadZone, ProcessingStatus, DocumentInfo
│   └── chat/                  # ChatContainer, ChatMessage, ChatInput, SourceList
├── hooks/                     # useDocumentUpload, useChat (client-only React state)
├── lib/
│   ├── client/                 # Browser-only fetch/SSE client (no server imports)
│   ├── db/                     # Mongo connection, collections, indexes, vector search
│   ├── pdf/                    # PDF extraction + normalization
│   ├── rag/                    # chunking, retrieval types, prompt construction
│   ├── providers/              # embedding + LLM provider abstractions (OpenAI/Gemini)
│   ├── services/                # orchestration: ingestion, embedding, retrieval, answer generation, chat
│   ├── validation/              # request validation schemas
│   └── utils/                   # errors, logging, rate limiting
├── types/                      # shared TypeScript types
└── tests/                      # Vitest unit tests (no network/DB/LLM calls)
```

## Setup

### Prerequisites
- Node.js **20.16.0** (this project intentionally does not require a newer Node version)
- MongoDB Atlas account, with a Vector Search index configured (see below)
- A Gemini API key and/or an OpenAI API key (at least one; both enables fallback)

## Day 1 — Ingestion Pipeline

`POST /api/upload` implements the full ingestion pipeline:

```
PDF file
  → file validation (MIME type, extension, size, PDF signature)
  → text extraction (lib/pdf/extract.ts, pdfjs-dist)
  → text normalization (lib/pdf/normalize.ts)
  → chunking (lib/rag/chunker.ts)
  → embedding generation (lib/services/embedding.service.ts — Gemini primary, OpenAI fallback)
  → embedding/chunk consistency validation
  → MongoDB Atlas persistence (documents + chunks)
```

The route itself (`app/api/upload/route.ts`) only validates the HTTP request and calls
`DocumentIngestionService` (`lib/services/document-ingestion.service.ts`), which owns the
pipeline end to end. A document is only ever written to MongoDB once extraction, chunking,
embedding, and consistency checks have all already succeeded in memory — a bad PDF or a
provider outage never leaves a document stuck in a half-processed state.

### Environment variables

| Variable | Required for | Notes |
| --- | --- | --- |
| `MONGODB_URI` | any database operation | Atlas connection string |
| `MONGODB_DB_NAME` | any database operation | |
| `GEMINI_API_KEY` | embedding generation and answer generation (both primary) | optional at startup; only validated when actually requested |
| `OPENAI_API_KEY` | embedding generation and answer generation (both fallback) | optional; used only if Gemini fails with a recoverable error (rate limit, 5xx, network) |
| `MONGODB_VECTOR_INDEX` | chat retrieval | optional, default `chunks_vector_index` — see Atlas Vector Search index below |
| `MONGODB_VECTOR_NUM_CANDIDATES` | chat retrieval | optional, default `50` — Atlas candidate pool size per query |

### Manual end-to-end validation

1. Set `MONGODB_URI`, `MONGODB_DB_NAME`, and `GEMINI_API_KEY` (and optionally `OPENAI_API_KEY`) in `.env.local`.
2. `npm run dev`
3. Upload a PDF:

   ```bash
   curl -X POST http://localhost:3000/api/upload \
     -F "file=@path/to/document.pdf"
   ```

4. A successful response looks like:

   ```json
   {
     "success": true,
     "document": {
       "id": "...",
       "fileName": "document.pdf",
       "status": "ready",
       "pageCount": 3,
       "chunkCount": 12,
       "embeddingConfiguration": { "provider": "gemini", "model": "gemini-embedding-2", "dimensions": 1536 }
     }
   }
   ```

5. In MongoDB Atlas, verify:
   - `documents`: one new document, `status: "ready"`, correct `pageCount`/`chunkCount`, `embeddingProvider`/`embeddingModel`/`embeddingDimensions` populated.
   - `chunks`: one document per chunk, `documentId` referencing the parent, `chunkIndex` sequential from 0, `embedding` populated, and `embeddingProvider`/`embeddingModel`/`embeddingDimensions` identical across every chunk of that document.

## Day 2 — Retrieval, Grounded Answers & Streaming

`POST /api/chat` runs the full RAG pipeline — retrieval, then a grounded, streamed answer:

```
{ documentId, message }
  → request validation (lib/validation/chat.schema.ts)
  → best-effort rate limit (lib/utils/rate-limit.ts)
  → RetrievalService: load document (must be status: "ready"), embed the question in the
    document's EXACT embedding configuration, run MongoDB Atlas $vectorSearch
  → if zero chunks were retrieved: skip the LLM entirely, stream a deterministic
    "not found in the document" answer (see "No-context behavior" below)
  → otherwise: buildRagPrompt() (lib/rag/prompt.ts) constructs a grounded system prompt from
    the retrieved chunks
  → AnswerGenerationService streams the answer via Gemini (primary) or OpenAI (fallback)
  → the response streams as Server-Sent Events: metadata → delta* → done (or error)
```

`ChatService` (`lib/services/chat.service.ts`) is the orchestration layer tying these together;
`RetrievalService` and `AnswerGenerationService` remain independent, separately testable services
— retrieval logic is unaware that its output will be fed to an LLM at all.

### Why the query embedding must match the document's configuration

A document may have been
embedded with either OpenAI (`text-embedding-3-small`) or Gemini (`gemini-embedding-2`) —
whichever succeeded at ingestion time (see the fallback behavior above). OpenAI and Gemini
vectors are not comparable, even at equal dimensions. `EmbeddingService.generateEmbeddings()`
(used at ingestion) is unsuitable here because it always prefers Gemini first — blindly reusing
it for a query would silently embed an OpenAI-configured document's question with Gemini,
producing a vector search that can never match. `generateEmbeddingForConfiguration()` instead
constructs the one provider matching the document's stored config, with no fallback, and rejects
(`EMBEDDING_CONFIGURATION_MISMATCH`) if the provider ever returns a different provider/model/
dimensions than requested.

### MongoDB Atlas Vector Search index (not created by this codebase)

Application code never creates the index — create it manually in the Atlas UI/CLI. Expected
definition, name configurable via `MONGODB_VECTOR_INDEX` (default `chunks_vector_index`):

```json
{
  "name": "chunks_vector_index",
  "type": "vectorSearch",
  "definition": {
    "fields": [
      { "type": "vector", "path": "embedding", "numDimensions": 1536, "similarity": "cosine" },
      { "type": "filter", "path": "documentId" },
      { "type": "filter", "path": "embeddingProvider" },
      { "type": "filter", "path": "embeddingModel" }
    ]
  }
}
```

The three `filter` fields are required, not optional — they're how the query stays scoped to one
document and one embedding space (see above). If the index is missing, misconfigured, or the
query fails for any other reason, `POST /api/chat` returns a structured `VECTOR_SEARCH_FAILED`
error; raw MongoDB/Atlas error detail is logged server-side only, never returned to the client.

Additional environment variable: `MONGODB_VECTOR_NUM_CANDIDATES` (optional, default `50`) — the
candidate pool size Atlas scans before returning the top 5 results.

### Prompt grounding strategy

`buildRagPrompt()` (`lib/rag/prompt.ts`) is the only place that constructs an answer prompt — the
API route and `ChatService` never assemble prompt text themselves, so every generation request
carries the same rules. The system prompt lists retrieved chunks as numbered `SOURCE [n]` blocks
(page number + content) and instructs the model to:

- answer **only** from the supplied excerpts, never external knowledge or assumptions,
- say explicitly that the information could not be found, rather than guess, when it isn't there,
- say explicitly when the retrieved context is insufficient, rather than fill the gap,
- reply in the same language as the question, preserve factual precision, and never mention the
  instructions themselves or claim to have searched anything outside the excerpts.

**No-context behavior:** when `RetrievalService` returns zero chunks, `ChatService` never calls an
LLM at all — it streams a deterministic canned answer ("I couldn't find this information in the
provided document." / the French equivalent for a French question) as a single `delta` event. This
is enforced in code, not just prompted for, so there's no dependency on the model choosing to
comply.

### LLM provider / fallback behavior

`AnswerGenerationService` (`lib/services/answer.service.ts`) mirrors the embedding layer's
fallback contract, adapted for streaming: Gemini is primary, OpenAI is the fallback, and a
fallback is only attempted when the primary fails **before yielding any output** with a
recoverable error (network error, HTTP 429, or 5xx — identical rule to embeddings, shared via
`lib/providers/recoverable-provider-error.ts`). A non-recoverable failure (bad request, invalid
key, etc.) is never retried against the fallback.

Once a provider has produced its first chunk, the stream is committed to that provider for the
rest of the answer — a later failure in the same stream is never silently retried against the
other provider, since that could concatenate two different models' output into what looks like
one answer. Instead it ends the stream with an `error` event (see the streaming protocol below).

### Streaming protocol

`POST /api/chat`'s response is `Content-Type: text/event-stream`, one event per line-pair, in this
order:

```
event: metadata
data: {"documentId":"...","sources":[{"id":"...","content":"...","pageNumber":1,"chunkIndex":0,"score":0.91}]}

event: delta
data: {"text":"partial answer text..."}

event: delta
data: {"text":" more text..."}

event: done
data: {}
```

or, if generation fails after the stream has already started:

```
event: error
data: {"code":"LLM_GENERATION_FAILED","message":"Answer generation failed via the gemini provider."}
```

`metadata` is always the first event and always carries the full `sources` array (possibly empty)
— the client renders sources from this event, not from parsing the answer text. Retrieval/
validation/configuration failures (bad request, document not found, document not ready, no
provider configured) are **not** streamed — they're returned as an ordinary JSON error response
before the stream starts, so the client gets a normal HTTP status code for those cases and only
needs SSE parsing for the success path. `lib/client/sse.ts` implements the parser (pure, unit
tested, no network) and `lib/client/api.ts` wires it to `fetch`.

### Rate limiting

`POST /api/chat` applies a best-effort limit of 10 requests per 60 seconds per client IP
(`lib/utils/rate-limit.ts`), returning `429 RATE_LIMITED` with a `Retry-After` header when
exceeded. This is an **in-memory, single-process** limiter — it is intentionally not presented as
a production defense. On Vercel (or any horizontally-scaled deployment) each serverless instance
keeps its own counters with no shared state, so it only bounds abuse against one warm instance,
not globally. A real production limit would need a shared store (e.g. Upstash Redis) keyed the
same way.

### Manually testing POST /api/chat

Requires a document already ingested via `POST /api/upload` (see above) and a real Atlas Vector
Search index configured as described. `-N` disables curl's output buffering so events print as
they arrive:

```bash
curl -N -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"documentId":"<id from the upload response>","message":"What are the objectives of the project?"}'
```

## Why not LangChain/LlamaIndex

Deliberate, not an oversight: the pipeline already has explicit, individually-owned stages —
extraction, chunking, embedding, retrieval, prompt construction, generation — each a small,
directly-testable module. At this project's scope, a framework would add an abstraction layer
without removing any real complexity, and would obscure exactly the decisions this assessment is
meant to demonstrate: the embedding-compatibility guarantee between ingestion and retrieval, the
provider-fallback rules (including the "never switch mid-stream" constraint), and the grounding
strategy. Explicit code here is easier to debug, easier to unit test without network access, and
keeps every one of those decisions visible and auditable in a handful of files.

## Vercel / serverless readiness

- `app/api/chat/route.ts` and `app/api/upload/route.ts` both declare `export const runtime = "nodejs"` — required, since the MongoDB driver, OpenAI SDK, and `@google/genai` SDK are all Node-only and cannot run on the Edge runtime.
- MongoDB connections are cached on `global` (`lib/db/mongodb.ts`), reused across warm invocations — unchanged from Day 1.
- No filesystem writes and no in-memory state required for correctness (the rate limiter is an explicitly best-effort exception, documented above).
- Streaming uses only standard Web APIs (`ReadableStream`, `Response`), which Vercel's Node.js functions support natively.
- All server-only dependencies (`mongodb`, `openai`, `@google/genai`, `lib/config/env.ts`, every `lib/services/*` and `lib/providers/*` module) are only ever imported from API routes — verified by inspecting the import graph of every client component/hook (`components/`, `hooks/`, `lib/client/`), none of which reach a server-only module.
- **Not yet deployed to Vercel** — the above is a readiness review of the code, not a report of an actual deployment.

## Known limitations

- No OCR — scanned/image-only PDFs fail with `PDF_TEXT_NOT_EXTRACTABLE` at ingestion.
- Chat history is session-only, kept in React state (`hooks/useChat.ts`); nothing is persisted, and reloading the page loses it.
- Single-document chat only — there is no UI to select among multiple previously uploaded documents.
- Rate limiting is a best-effort, single-instance limiter (see above), not a distributed production defense.
- The Atlas Vector Search index must be created and maintained manually (see above) — it is not managed by application code.
