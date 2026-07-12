import type { QuestionType } from "./types";

export interface GradeQuestionInput {
  type: QuestionType;
  expectedAnswer: unknown;
  submittedAnswer: unknown;
  score: number;
}

export interface GradeQuestionResult {
  score: number | null;
  autoGraded: boolean;
  correct: boolean | null;
}

export function gradeQuestion(input: GradeQuestionInput): GradeQuestionResult {
  if (input.type === "short_answer") {
    return {
      score: null,
      autoGraded: false,
      correct: null,
    };
  }

  const correct = answerMatches(input.expectedAnswer, input.submittedAnswer);

  return {
    score: correct ? input.score : 0,
    autoGraded: true,
    correct,
  };
}

function answerMatches(expected: unknown, submitted: unknown): boolean {
  if (Array.isArray(expected)) {
    if (!Array.isArray(submitted)) {
      return false;
    }

    const expectedValues = expected.map(normalizeAnswer).sort();
    const submittedValues = submitted.map(normalizeAnswer).sort();

    return JSON.stringify(expectedValues) === JSON.stringify(submittedValues);
  }

  return normalizeAnswer(expected) === normalizeAnswer(submitted);
}

function normalizeAnswer(value: unknown): string {
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (typeof value === "number") {
    return String(value);
  }

  if (typeof value === "string") {
    return value.trim().replace(/\s+/g, " ").toLowerCase();
  }

  return JSON.stringify(value);
}
