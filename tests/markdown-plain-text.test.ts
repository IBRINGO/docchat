import { describe, expect, it } from "vitest";
import { markdownToPlainText } from "@/lib/utils/markdown";

describe("markdownToPlainText", () => {
  it("strips bold and italic markers", () => {
    expect(markdownToPlainText("This is **bold** and *italic* text.")).toBe("This is bold and italic text.");
  });

  it("strips heading markers", () => {
    expect(markdownToPlainText("# Title\n\n## Subtitle\ntext")).toBe("Title\n\nSubtitle\ntext");
  });

  it("strips inline code backticks", () => {
    expect(markdownToPlainText("Run `npm test` to check.")).toBe("Run npm test to check.");
  });

  it("strips fenced code block markers but keeps the code content", () => {
    const input = "Here:\n```ts\nconst x = 1;\n```\nDone.";
    const result = markdownToPlainText(input);
    expect(result).toContain("const x = 1;");
    expect(result).not.toContain("```");
  });

  it("normalizes unordered list bullets", () => {
    expect(markdownToPlainText("* first\n* second")).toBe("- first\n- second");
  });

  it("collapses more than two consecutive blank lines", () => {
    expect(markdownToPlainText("a\n\n\n\nb")).toBe("a\n\nb");
  });

  it("handles the sample streamed answer from the task spec without merging separate bullet lines", () => {
    const input = "1. **Cycle Ingénieur en Data Science et IoT**\n   * **Établissement :** ENSIAS\n   * **Période :** 2023 – 2026";
    const result = markdownToPlainText(input);
    expect(result).not.toContain("**");
    expect(result).not.toContain("*");
    expect(result).toContain("Cycle Ingénieur en Data Science et IoT");
    expect(result).toContain("- Établissement : ENSIAS");
    expect(result).toContain("- Période : 2023 – 2026");
    // Both bullet lines must survive independently, not get merged into one by a greedy multi-line match.
    expect(result.split("\n")).toHaveLength(3);
  });

  it("does not let an italic match span across separate bullet lines that each contain one literal asterisk", () => {
    const input = "* alpha\n* beta\n* gamma";
    const result = markdownToPlainText(input);
    expect(result.split("\n")).toEqual(["- alpha", "- beta", "- gamma"]);
  });
});
