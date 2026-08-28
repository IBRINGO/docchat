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
  -d '{"documentIds":["<id from the upload response>"],"message":"What are the objectives of the project?"}'
```

Add a second id to `documentIds` to chat across multiple documents at once (see "Multi-Document RAG & Conversations" below); add `"conversationId":"<id>"` to continue an existing conversation instead of starting a new one.

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

## Document Library & Multi-Document Selection

`GET /api/documents` lists previously uploaded documents with search, status filtering, and
pagination:

```
GET /api/documents?q=report&status=ready&page=1&limit=20
```

| Param | Notes |
| --- | --- |
| `q` | optional, case-insensitive substring match on filename (regex-escaped — a literal match, never a pattern) |
| `status` | optional, one of `processing` \| `ready` \| `failed` — the same `DocumentStatus` the rest of the app uses, no parallel status system |
| `page` / `limit` | optional, default `1`/`20`, `limit` capped at `100` |

The response never includes embeddings, chunk content, or embedding provider/model metadata —
just what a document picker needs (`id`, `fileName`, `mimeType`, `size`, `pageCount`,
`chunkCount`, `status`, `createdAt`, and `errorMessage` for failed documents only). Sorted
newest-first, which the existing `documents_createdAt` index already serves — no new index was
needed for this query shape at the project's scale.

The frontend (`components/documents/`, `hooks/useDocumentLibrary.ts`,
`hooks/useDocumentSelection.ts`) builds a document library on top of this: search, status tabs,
and multi-select checkboxes. A document whose status isn't `ready` is rendered disabled and
cannot be selected — this is enforced both visually and in `canSelectDocument()`
(`lib/validation/document-selection.ts`), the same predicate that also gates the chat pipeline.

### Why multi-document support does not multiply the original assessment limits

The assessment specifies, per document: native-text PDF, ≤10 MB, ≤~50 pages. Multi-document
selection is a bonus on top of that scope, not a way around it — so it enforces limits at two
levels (`lib/config/document-limits.ts`, the single source of truth for both):

1. **Per document (unchanged, now also checks page count):** `validateUploadedFile()` still
   enforces the 10 MB / PDF-only checks at upload time; `DocumentIngestionService` now also
   rejects a document over `MAX_DOCUMENT_PAGE_COUNT` (50) right after extraction — before
   spending anything on chunking or embedding — with `PDF_TOO_MANY_PAGES`.
2. **Per active selection:** `MAX_ACTIVE_SELECTION_TOTAL_SIZE_BYTES` and
   `MAX_ACTIVE_SELECTION_TOTAL_PAGES` are **equal to**, not a multiple of, the single-document
   limits (10 MB / 50 pages total, however many documents that spans). Selecting a second or
   third document never raises the ceiling — it only lets the same fixed budget be spread across
   more than one file.

`lib/validation/document-selection.ts` is the framework-independent implementation:
`validateSelectionLimits(currentSelection, candidate)` returns
`{ valid, reason?: "MAX_TOTAL_SIZE" | "MAX_TOTAL_PAGES" | "MAX_TOTAL_SIZE_AND_PAGES", totals }`,
and `toggleDocumentSelection(selectedIds, documentsById, targetId)` uses it to decide whether
selecting a document is allowed — rejecting the attempt and leaving the existing selection
untouched otherwise, never landing the user in an over-limit state. It has no React dependency,
so `hooks/useDocumentSelection.ts` is a thin adapter, and the same functions are directly unit
tested (`tests/document-selection.test.ts`) and reusable by a future API-side validation pass.

No cap on the *number* of selected documents is enforced yet — the size/page totals are the real
constraint — but `MAX_ACTIVE_SELECTION_DOCUMENT_COUNT` exists in `document-limits.ts` as an
explicit, currently-`null` hook so one can be added later without restructuring callers.

## Multi-Document RAG & Conversations

`POST /api/chat` answers from one or more documents in a single request, and persists the
conversation:

```
{ documentIds: string[], message: string, conversationId?: string }
```

`documentIds` fully replaces the earlier single-`documentId` contract — a deliberate, one-time
breaking change (see Part 1 of the task this implements) rather than supporting two parallel
request shapes indefinitely. A single document is just the `documentIds.length === 1` case; every
rule below applies uniformly regardless of how many documents are selected. Duplicate IDs in the
array are silently deduplicated (first-seen order kept), not rejected — an accidental repeat isn't
a meaningfully different request. All of it is re-validated server-side (valid ObjectIds, every
document exists and is `"ready"`, the combined selection respects the cumulative size/page limits)
— the backend never trusts the frontend's own selection UI.

### Embedding configuration grouping

Documents in one request may have been embedded under different configurations — e.g. one via
Gemini (`gemini-embedding-2`), another via the OpenAI fallback (`text-embedding-3-small`), because
whichever provider happened to succeed at ingestion time for each one. **Vectors from different
providers or models are never comparable, even at identical dimensions** — this is the same rule
enforced for single-document retrieval, just applied per-document now instead of per-request.

`RetrievalService.retrieve()` groups the selected documents by the triple
`(embeddingProvider, embeddingModel, embeddingDimensions)` before doing anything else:

```
Group 1 — openai / text-embedding-3-small / 1536:  [Document A, Document C]
Group 2 — gemini / gemini-embedding-2 / 1536:       [Document B, Document D]
```

For each group, independently: generate ONE query embedding using exactly that group's
configuration (`EmbeddingService.generateEmbeddingForConfiguration` — never the default
provider), then run one Atlas `$vectorSearch` scoped to that group's document IDs via a
`documentId: { $in: [...] }` filter alongside the existing `embeddingProvider`/`embeddingModel`
filters. This means one Atlas query per *distinct embedding configuration* in the request, not one
per document — selecting five documents that all share the same configuration still costs exactly
one query embedding and one vector search call.

### Result merging and ranking

Each group returns its own top-5 chunks, already sorted by Atlas's `vectorSearchScore`. The merge
strategy is deliberately simple: concatenate every group's results, sort the combined list by
score descending, and take the global top 5. No extra per-group rescaling is applied — for the
cosine similarity metric this app's Atlas index uses, `vectorSearchScore` is normalized by Atlas
itself onto a fixed 0–1 scale independent of the underlying embedding model, so a straightforward
global sort is a reasonable, deterministic, and fully explainable merge without inventing a
weighting scheme with no real evidence behind it. The final result is always bounded to 5 chunks
regardless of how many documents (or groups) were selected — selecting more documents changes
*which* chunks compete for those 5 slots, never how many make it into the prompt.

**Lightweight lexical re-ranking (bonus) was deliberately not implemented.** Blending in a
keyword/token-overlap signal on top of vector similarity is a real technique, but adding it here
would mean inventing and tuning a semantic/lexical weighting scheme with no evaluation data to
justify any particular weighting — that's exactly the kind of complexity this assessment's
grounding/compatibility requirements were prioritized over. Semantic-first retrieval via Atlas
Vector Search remains the sole ranking signal.

### Grounded multi-document prompt

`buildRagPrompt()` (unchanged location, `lib/rag/prompt.ts`) labels every `SOURCE [n]` block with
its originating `Document:` name, and the system prompt explicitly instructs the model to
attribute claims to the correct document, never claim a document says something it doesn't, and
mention differences between documents when relevant — on top of the existing single-document
grounding rules (context-only, no external knowledge, say when the answer isn't supported). This
is still the *only* place prompt text is constructed; routes and services never build prompt text
themselves.

### Conversation data model

Two new collections, `conversations` and `messages` (`types/conversation.ts`,
`lib/db/collections.ts`):

```ts
Conversation { _id, title, documentIds: ObjectId[], createdAt, updatedAt }
Message { _id, conversationId, role: "user" | "assistant", content, sources: SourceReference[], createdAt }
```

`sources` on an assistant message is a denormalized snapshot (`documentId`, `documentName`,
`chunkId`, `content`, `pageNumber`, `chunkIndex`, `score`) — not a live reference — so conversation
history keeps displaying correctly even if a source document is later deleted or re-ingested.
User messages always store `sources: []`.

### Conversation/document context rule

**A conversation's document context is fixed at creation.** Continuing an existing conversation
(`conversationId` provided) requires the request's `documentIds` to match the conversation's
stored set exactly, order ignored — otherwise the request is rejected with
`CONVERSATION_DOCUMENT_CONTEXT_MISMATCH` (409). This is a deliberate simplification: it avoids
ever having to reconcile a mid-conversation switch between incompatible document/embedding
contexts, and keeps "which documents was this conversation grounded in" an unambiguous, permanent
fact. Changing the document selection always means starting a new conversation — the frontend
(`hooks/useChat.ts`) detects this locally (comparing the active conversation's document set
against the current selection) and starts fresh automatically rather than sending a request the
server would reject anyway, showing a small notice first so the switch isn't silent.

### Streaming persistence behavior

`ChatService.prepare()` — which runs to completion *before* the SSE response starts — resolves/
creates the conversation and persists the user message first, so a conversation only ever exists
once its triggering message is known to be valid (a request that fails retrieval/validation never
leaves an orphaned conversation behind). `ChatService.streamAnswer()` then collects the assistant's
full text internally while forwarding each delta to the client, and persists it as the assistant
message **only after generation has completed successfully** — a failed or mid-stream-interrupted
generation is never saved as if it were a complete answer; only an SSE `error` event is sent, and
the user's message (and any earlier turns) remain in the conversation. If persistence of the
*already-fully-streamed* assistant message itself fails (e.g. a transient Mongo write error after
generation succeeded), that failure is logged server-side but does not retroactively turn an
answer the user already received into an error — the client still gets a normal `done`.

The `metadata` SSE event now carries `conversationId` and `documentIds` alongside `sources`, so the
client can associate the stream with the right conversation from the first event — see the
Streaming protocol section above for the full event sequence (unchanged otherwise).

### Conversation API

| Endpoint | Notes |
| --- | --- |
| `GET /api/conversations?page=&limit=` | Summaries sorted by `updatedAt` descending — `id`, `title`, `documentIds`, `documentNames` (resolved via one batched lookup across the whole page, not one query per conversation), `createdAt`, `updatedAt` |
| `GET /api/conversations/:id` | Full conversation metadata plus every message, oldest first, with each assistant message's `sources` |
| `DELETE /api/conversations/:id` | Deletes the conversation's messages, then the conversation itself |

All three are rate-limited the same best-effort way as `/api/chat` (see "Rate limiting" above),
with a more generous limit since they're plain reads/deletes, not LLM calls.

### Database indexes

Added to `initializeDatabaseIndexes()` (`lib/db/indexes.ts`, still idempotent, still run manually
via `npm run db:indexes` — never automatically):

```
conversations: { updatedAt: -1 }                     — powers GET /api/conversations' sort
messages:      { conversationId: 1, createdAt: 1 }    — powers ordered message history lookup
```

### Frontend integration

`hooks/useChat.ts` now owns one active conversation (messages + `conversationId`, previously just
messages for a single fixed document) and exposes `sendMessage(documentIds, text)`,
`loadConversation(...)` (restores an existing conversation's messages and document context — used
when the sidebar is clicked), and `startNewChat()`. `hooks/useDocumentSelection.ts` gained
`setSelection(ids)` for that same restoration path (bypassing the incremental add-one-at-a-time
limit check, since a stored conversation's document set was already valid when created).
`components/conversations/ConversationSidebar.tsx` is new: a "New chat" action plus the
conversation list, each item showing its title and document names, with delete. The page layout
(`app/page.tsx`) became two columns on larger screens — the conversation sidebar on the left,
upload/library/selection/chat stacked in the main column — collapsing to a single stacked column
on mobile.

## Known limitations

- No OCR — scanned/image-only PDFs fail with `PDF_TEXT_NOT_EXTRACTABLE` at ingestion.
- No lightweight lexical re-ranking — retrieval is semantic-only via Atlas Vector Search (see "Result merging and ranking" above for why).
- Restoring an existing conversation restores its document *selection state* correctly, but a document the conversation references that has since scrolled off the currently-loaded/filtered library page won't visually appear checked in the list until it's loaded — a cosmetic edge case, not a data-correctness one (the conversation's real document context, enforced server-side, is unaffected).
- Rate limiting is a best-effort, single-instance limiter (see below), not a distributed production defense.
- The Atlas Vector Search index must be created and maintained manually (see above) — it is not managed by application code.
- The document library's and conversation sidebar's "load more"/single-page pagination have no jump-to-page control — adequate at this project's scale.
- No authentication — every conversation and document is visible to any client that can reach the API; access control is out of scope for this assessment.
