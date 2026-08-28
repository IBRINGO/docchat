import { describe, expect, it } from "vitest";
import { classifyRelevance, formatRelevancePercent, getRelevancePresentation } from "@/lib/utils/relevance";

describe("classifyRelevance", () => {
  it("classifies scores at and above 0.75 as strong", () => {
    expect(classifyRelevance(0.75)).toBe("strong");
    expect(classifyRelevance(0.99)).toBe("strong");
    expect(classifyRelevance(1)).toBe("strong");
  });

  it("classifies scores in [0.5, 0.75) as relevant", () => {
    expect(classifyRelevance(0.5)).toBe("relevant");
    expect(classifyRelevance(0.74)).toBe("relevant");
  });

  it("classifies scores below 0.5 as lower", () => {
    expect(classifyRelevance(0.49)).toBe("lower");
    expect(classifyRelevance(0)).toBe("lower");
  });
});

describe("formatRelevancePercent", () => {
  it("rounds to the nearest whole percent", () => {
    expect(formatRelevancePercent(0.914)).toBe(91);
    expect(formatRelevancePercent(0.915)).toBe(92);
  });

  it("clamps out-of-range scores into 0-100", () => {
    expect(formatRelevancePercent(-0.2)).toBe(0);
    expect(formatRelevancePercent(1.5)).toBe(100);
  });
});

describe("getRelevancePresentation", () => {
  it("bundles percent, tier, and a restrained label — never using the word 'confidence'", () => {
    const presentation = getRelevancePresentation(0.91);
    expect(presentation).toEqual({ percent: 91, tier: "strong", label: "Strong match" });
    expect(presentation.label.toLowerCase()).not.toContain("confidence");
  });

  it("labels a lower-tier score without alarming language", () => {
    const presentation = getRelevancePresentation(0.3);
    expect(presentation.tier).toBe("lower");
    expect(presentation.label).toBe("Lower match");
  });
});
