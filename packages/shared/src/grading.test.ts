import { describe, expect, it } from "vitest";
import { gradeQuestion } from "./grading";

describe("gradeQuestion", () => {
  it("grades single choice answers", () => {
    expect(
      gradeQuestion({
        type: "single_choice",
        expectedAnswer: "A",
        submittedAnswer: "a",
        score: 5,
      }),
    ).toMatchObject({ score: 5, autoGraded: true, correct: true });
  });

  it("requires exact set matching for multiple choice answers", () => {
    expect(
      gradeQuestion({
        type: "multiple_choice",
        expectedAnswer: ["A", "C"],
        submittedAnswer: ["C", "A"],
        score: 8,
      }).score,
    ).toBe(8);

    expect(
      gradeQuestion({
        type: "multiple_choice",
        expectedAnswer: ["A", "C"],
        submittedAnswer: ["A"],
        score: 8,
      }).score,
    ).toBe(0);
  });

  it("normalizes fill blank whitespace and case", () => {
    expect(
      gradeQuestion({
        type: "fill_blank",
        expectedAnswer: "Signal Flow",
        submittedAnswer: " signal   flow ",
        score: 4,
      }).correct,
    ).toBe(true);
  });

  it("leaves short answers for manual review", () => {
    expect(
      gradeQuestion({
        type: "short_answer",
        expectedAnswer: null,
        submittedAnswer: "Because...",
        score: 10,
      }),
    ).toMatchObject({ score: null, autoGraded: false, correct: null });
  });
});
