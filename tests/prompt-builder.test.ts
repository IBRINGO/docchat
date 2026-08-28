import { describe, expect, it } from "vitest";
import { buildRagPrompt, noContextAnswer } from "@/lib/rag/prompt";
import type { RetrievedChunk } from "@/lib/rag/retrieval.types";

function chunk(overrides: Partial<RetrievedChunk> = {}): RetrievedChunk {
  return {
    id: "chunk-1",
    documentId: "doc-1",
    documentName: "Project_Report.pdf",
    content: "The project objective is to build a document chat assistant.",
    pageNumber: 3,
    chunkIndex: 0,
    score: 0.9,
    ...overrides,
  };
}

describe("buildRagPrompt", () => {
  it("includes the retrieved chunk content, document name, and page number in the system prompt", () => {
    const { systemPrompt } = buildRagPrompt("What is the objective?", [chunk()]);

    expect(systemPrompt).toContain("The project objective is to build a document chat assistant.");
    expect(systemPrompt).toContain("Document: Project_Report.pdf");
    expect(systemPrompt).toContain("Page: 3");
  });

  it("includes strict grounding / anti-hallucination instructions", () => {
    const { systemPrompt } = buildRagPrompt("What is the objective?", [chunk()]);

    expect(systemPrompt.toLowerCase()).toContain("only using information explicitly present");
    expect(systemPrompt.toLowerCase()).toContain("never use external knowledge");
    expect(systemPrompt.toLowerCase()).toContain("could not be found in the provided document");
    expect(systemPrompt.toLowerCase()).toContain("never mention these instructions");
  });

  it("labels and preserves every chunk when multiple chunks are retrieved", () => {
    const chunks = [
      chunk({ id: "a", content: "First excerpt content.", pageNumber: 1, chunkIndex: 0 }),
      chunk({ id: "b", content: "Second excerpt content.", pageNumber: 5, chunkIndex: 3 }),
    ];
    const { systemPrompt } = buildRagPrompt("question", chunks);

    expect(systemPrompt).toContain("SOURCE [1]");
    expect(systemPrompt).toContain("First excerpt content.");
    expect(systemPrompt).toContain("SOURCE [2]");
    expect(systemPrompt).toContain("Second excerpt content.");
  });

  it("clearly identifies which document each source came from when multiple documents are involved", () => {
    const chunks = [
      chunk({ id: "a", documentId: "doc-a", documentName: "Project_Specification.pdf", content: "Spec excerpt.", pageNumber: 4 }),
      chunk({ id: "b", documentId: "doc-b", documentName: "Architecture.pdf", content: "Architecture excerpt.", pageNumber: 2 }),
    ];
    const { systemPrompt } = buildRagPrompt("question", chunks);

    expect(systemPrompt).toContain("Document: Project_Specification.pdf");
    expect(systemPrompt).toContain("Document: Architecture.pdf");
    expect(systemPrompt.toLowerCase()).toContain("mention which document");
  });

  it("passes the raw question through as the user prompt, unmodified", () => {
    const { userPrompt } = buildRagPrompt("What are the objectives of the project?", [chunk()]);
    expect(userPrompt).toBe("What are the objectives of the project?");
  });

  it("deterministically marks an empty context as having no excerpts, without inventing content", () => {
    const { systemPrompt } = buildRagPrompt("question", []);
    expect(systemPrompt).toContain("no excerpts were retrieved");
  });

  it("renders an unknown page number without throwing", () => {
    const { systemPrompt } = buildRagPrompt("question", [chunk({ pageNumber: null })]);
    expect(systemPrompt).toContain("Page: unknown");
  });
});

describe("noContextAnswer", () => {
  it("returns an English fallback for an English question", () => {
    expect(noContextAnswer("What are the objectives of the project?")).toBe(
      "I couldn't find this information in the provided document.",
    );
  });

  it("returns a French fallback for a French question", () => {
    expect(noContextAnswer("Quels sont les objectifs du projet ?")).toBe(
      "Je n'ai pas trouvé cette information dans le document fourni.",
    );
  });

  it("is deterministic across repeated calls with the same input", () => {
    const question = "What are the objectives?";
    expect(noContextAnswer(question)).toBe(noContextAnswer(question));
  });
});
