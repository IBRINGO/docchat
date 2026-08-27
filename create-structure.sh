#!/bin/bash

# Script pour créer l'arborescence du projet DocChat
# Utilisation : ./create-structure.sh
# À exécuter depuis B:\Smartly\docchat ou adapter le chemin

set -e  # Arrêter le script en cas d'erreur

PROJECT_ROOT="B:/Smartly/docchat"

# Fonction pour créer un répertoire s'il n'existe pas
create_dir() {
    if [ ! -d "$1" ]; then
        mkdir -p "$1"
        echo "✅ Répertoire créé : $1"
    else
        echo "⏭️  Répertoire déjà existant : $1"
    fi
}

# Fonction pour créer un fichier s'il n'existe pas
create_file() {
    if [ ! -f "$1" ]; then
        touch "$1"
        echo "✅ Fichier créé : $1"
    else
        echo "⏭️  Fichier déjà existant : $1"
    fi
}

# Aller à la racine du projet
cd "$PROJECT_ROOT" || {
    echo "❌ Le répertoire $PROJECT_ROOT n'existe pas. Veuillez d'abord créer le projet avec :"
    echo "   npx create-next-app@latest docchat"
    echo "   cd B:/Smartly/docchat"
    exit 1
}

echo "📁 Création de l'arborescence pour DocChat..."
echo ""

# --- APP (API Routes) ---
echo "📂 APP/"

# Dossiers app
create_dir "app/api/upload"
create_dir "app/api/chat"

# Fichiers app
create_file "app/layout.tsx"
create_file "app/page.tsx"
create_file "app/globals.css"
create_file "app/api/upload/route.ts"
create_file "app/api/chat/route.ts"

echo ""

# --- COMPONENTS ---
echo "📂 COMPONENTS/"

# Dossiers components
create_dir "components/upload"
create_dir "components/chat"

# Fichiers components
create_file "components/upload/UploadZone.tsx"
create_file "components/upload/ProcessingStatus.tsx"
create_file "components/upload/DocumentInfo.tsx"
create_file "components/chat/ChatContainer.tsx"
create_file "components/chat/ChatMessage.tsx"
create_file "components/chat/ChatInput.tsx"
create_file "components/chat/SourceList.tsx"

echo ""

# --- LIB ---
echo "📂 LIB/"

# Dossiers lib
create_dir "lib/db"
create_dir "lib/pdf"
create_dir "lib/rag"
create_dir "lib/providers"
create_dir "lib/services"
create_dir "lib/repositories"
create_dir "lib/validation"
create_dir "lib/utils"

# Fichiers lib
create_file "lib/db/mongodb.ts"
create_file "lib/db/collections.ts"
create_file "lib/pdf/extract.ts"
create_file "lib/pdf/types.ts"
create_file "lib/rag/chunker.ts"
create_file "lib/rag/retrieval.ts"
create_file "lib/rag/prompt.ts"
create_file "lib/providers/llm.provider.ts"
create_file "lib/providers/embedding.provider.ts"
create_file "lib/services/document.service.ts"
create_file "lib/services/chat.service.ts"
create_file "lib/repositories/document.repository.ts"
create_file "lib/repositories/chunk.repository.ts"
create_file "lib/validation/upload.schema.ts"
create_file "lib/validation/chat.schema.ts"
create_file "lib/utils/errors.ts"
create_file "lib/utils/logger.ts"

echo ""

# --- TYPES ---
echo "📂 TYPES/"
create_dir "types"
create_file "types/document.ts"
create_file "types/chunk.ts"
create_file "types/chat.ts"
create_file "types/api.ts"

echo ""

# --- TESTS ---
echo "📂 TESTS/"
create_dir "tests"
create_file "tests/chunker.test.ts"
create_file "tests/prompt.test.ts"

echo ""

# --- PUBLIC ---
echo "📂 PUBLIC/"
create_dir "public"

echo ""

# --- FICHIERS RACINE ---
echo "📄 FICHIERS RACINE"

# Créer .env.local avec des variables d'exemple
if [ ! -f ".env.local" ]; then
    cat > .env.local << 'EOF'
MONGODB_URI="your_mongodb_uri"
MONGODB_DB_NAME="docchat"
OPENAI_API_KEY="your_openai_api_key"
# Ou autre provider :
# GEMINI_API_KEY="your_gemini_api_key"
# COHERE_API_KEY="your_cohere_api_key"
NEXT_PUBLIC_APP_URL="http://localhost:3000"
EOF
    echo "✅ Fichier créé : .env.local"
else
    echo "⏭️  Fichier déjà existant : .env.local"
fi

# Créer .env.example
if [ ! -f ".env.example" ]; then
    cat > .env.example << 'EOF'
MONGODB_URI="your_mongodb_uri"
MONGODB_DB_NAME="docchat"
OPENAI_API_KEY="your_openai_api_key"
# GEMINI_API_KEY="your_gemini_api_key"
# COHERE_API_KEY="your_cohere_api_key"
NEXT_PUBLIC_APP_URL="http://localhost:3000"
EOF
    echo "✅ Fichier créé : .env.example"
else
    echo "⏭️  Fichier déjà existant : .env.example"
fi

# README.md
if [ ! -f "README.md" ]; then
    cat > README.md << 'EOF'
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

### Installation
1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
Copy environment variables:

bash
cp .env.example .env.local
Fill in your environment variables in .env.local

Running Locally
bash
npm run dev
The app will be available at http://localhost:3000

Deployment on Vercel
Push your code to GitHub

Import your repository on Vercel

Add environment variables in Vercel dashboard

Deploy

Environment Variables
Variable	Description
MONGODB_URI	MongoDB connection string
MONGODB_DB_NAME	Database name
OPENAI_API_KEY	OpenAI API key (or other provider)
NEXT_PUBLIC_APP_URL	Application URL
RAG Pipeline
Chunking Strategy
Chunk Size: 1000 tokens

Overlap: 200 tokens

Justification: Balances context preservation with granularity

Retrieval
Method: Cosine similarity search on vector embeddings

Top-K: 5 most similar chunks

Fallback: Keyword search if vector results are insufficient

Prompt Engineering
System prompt constrains LLM to use only provided context

Explicit instruction to say "I don't know" if information is missing

API Endpoints
POST /api/upload
Upload and process a PDF document.

Request: Multipart form data with file field
Response: { documentId: string, chunksCount: number }

POST /api/chat
Send a question about a document.

Request: { documentId: string, message: string, sessionId?: string }
Response: { answer: string, sources: Source[] }

Testing
bash
npm test
License
Private - For Smartly.ai technical test purposes only.
EOF
echo "✅ Fichier créé : README.md"
else
echo "⏭️ Fichier déjà existant : README.md"
fi

Mettre à jour package.json pour ajouter les dépendances nécessaires
(Optionnel - ceci est une suggestion, à exécuter manuellement si besoin)
echo ""
echo "📦 Dépendances recommandées à installer :"
echo " npm install mongodb pdf-parse @langchain/core @langchain/openai"
echo " npm install -D @types/node @types/react @types/react-dom"

echo ""
echo "✅ Structure du projet créée avec succès dans : $PROJECT_ROOT"
echo ""
echo "📊 Récapitulatif des dossiers et fichiers créés :"
find . -type d -not -path "*/.*" -not -path "/node_modules/" | sort
echo ""
echo "🚀 Prochaines étapes :"
echo "1. Installer les dépendances : npm install"
echo "2. Configurer les variables d'environnement dans .env.local"
echo "3. Lancer le développement : npm run dev"
echo "4. Déployer sur Vercel"