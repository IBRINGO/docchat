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
