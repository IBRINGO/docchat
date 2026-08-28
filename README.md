# DocChat - Smartly.ai Technical Test

## Description
DocChat is a full-stack application that allows users to upload PDF documents and ask natural language questions about their content using RAG (Retrieval-Augmented Generation).

## Architecture

### Tech Stack
- **Frontend**: Next.js 14+ (React, TypeScript)
- **Backend**: Next.js API Routes (Serverless)
- **Database**: MongoDB Atlas (Vector Search)
- **LLM**: OpenAI / Gemini / Cohere
- **Embeddings**: OpenAI / Cohere / Voyage
- **Deployment**: Vercel

### Project Structure
docchat/
├── app/ # Next.js App Router
│ ├── api/ # API routes
│ │ ├── upload/ # PDF upload endpoint
│ │ └── chat/ # Chat endpoint
│ ├── layout.tsx # Root layout
│ └── page.tsx # Main page
├── components/ # React components
│ ├── upload/ # Upload UI components
│ └── chat/ # Chat UI components
├── lib/ # Core business logic
│ ├── db/ # Database connections
│ ├── pdf/ # PDF extraction
│ ├── rag/ # RAG pipeline (chunking, retrieval, prompt)
│ ├── providers/ # LLM & Embedding providers
│ ├── services/ # Business services
│ ├── repositories/ # Data access layer
│ ├── validation/ # Input validation schemas
│ └── utils/ # Utilities (errors, logging)
├── types/ # TypeScript type definitions
└── tests/ # Unit tests

text

## Setup

### Prerequisites
- Node.js 18+
- MongoDB Atlas account (or local MongoDB)
- LLM API key (OpenAI, Gemini, or Cohere)

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
| `GEMINI_API_KEY` | embedding generation (primary) | optional at startup; only validated when an embedding is actually requested |
| `OPENAI_API_KEY` | embedding generation (fallback) | optional; used only if Gemini fails with a recoverable error (rate limit, 5xx, network) |

### MongoDB Atlas Vector Search (not created by this codebase)

The `chunks` collection is shaped for vector search, but the Atlas Vector Search index itself
must be created manually in the Atlas UI/CLI — application code intentionally never creates it.
Expected configuration:

- **Target field:** `chunks.embedding`
- **Similarity:** cosine
- **Dimensions:** must match the active embedding configuration (`text-embedding-3-small` → 1536;
  `gemini-embedding-2` → 1536 as configured in `lib/providers/gemini-embedding.provider.ts`)
- **Important:** OpenAI and Gemini embeddings are different vector spaces, even at equal
  dimensions. Every chunk also stores `embeddingProvider` and `embeddingModel`; any future
  `$vectorSearch` query must filter on those fields so a search never compares vectors across
  providers/models. Retrieval itself is not implemented yet (Day 2).

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
