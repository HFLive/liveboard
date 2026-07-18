import { ExercisesService } from "./exercises.service";
import type { PrismaService } from "../prisma/prisma.service";

describe("ExercisesService", () => {
  const prisma = {
    user: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    exerciseSet: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    teachingDeckItem: { count: jest.fn() },
    submission: {
      findUnique: jest.fn(),
      groupBy: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  let service: ExercisesService;

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.user.findUnique.mockImplementation(({ where }) =>
      Promise.resolve({
        id: where.id,
        status: "active",
        systemRole: "member",
      }),
    );
    prisma.user.findMany.mockImplementation(({ where }) =>
      Promise.resolve(where.id.in.map((id: string) => ({ id }))),
    );
    prisma.teachingDeckItem.count.mockResolvedValue(0);
    service = new ExercisesService(prisma as unknown as PrismaService);
  });

  it("lists quizzes with aggregated submissions", async () => {
    const updatedAt = new Date("2026-07-14T00:00:00Z");
    prisma.exerciseSet.findMany.mockResolvedValue([
      {
        id: "exercise-1",
        fileId: null,
        title: "章节练习",
        createdById: "teacher-1",
        createdBy: {
          id: "teacher-1",
          username: "teacher",
          displayName: "Teacher",
          avatarUpdatedAt: null,
          systemRole: "member",
          status: "active",
        },
        viewers: [],
        _count: { questions: 3, submissions: 12 },
        submissions: [{ status: "graded", score: 8, maxScore: 10 }],
        openAt: null,
        dueAt: null,
        updatedAt,
      },
    ]);
    prisma.submission.groupBy.mockResolvedValue([
      { exerciseSetId: "exercise-1", _count: { _all: 2 } },
    ]);

    const result = await service.listExerciseSets("learner-1");

    expect(result).toEqual([
      expect.objectContaining({
        title: "章节练习",
        questionCount: 3,
        submissionCount: 12,
        pendingReviewCount: 2,
        latestSubmissionStatus: "graded",
      }),
    ]);
  });

  it("does not expose correct answers to a learner before submission", async () => {
    prisma.exerciseSet.findUnique.mockResolvedValue({
      id: "exercise-1",
      fileId: null,
      title: "练习",
      createdById: "teacher-1",
      viewers: [{ userId: "learner-1" }],
      showAnswerAfterSubmit: true,
      submissions: [],
      questions: [
        {
          id: "question-1",
          promptJson: { text: "题目" },
          answerJson: "A",
        },
      ],
    });

    const result = await service.getExerciseSet("learner-1", "exercise-1");

    expect(result.questions[0]).not.toHaveProperty("answerJson");
  });

  it("rejects duplicate choice options before creating a quiz", async () => {
    await expect(
      service.createExerciseSet("lecturer-1", {
        title: "章节测验",
        questions: [
          {
            type: "single_choice",
            promptJson: { text: "请选择" },
            optionsJson: { options: ["A", "A"] },
            answerJson: "A",
            score: 5,
          },
        ],
      }),
    ).rejects.toThrow("第 1 题需要至少两个不重复的选项");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("creates the quiz directly without requiring any folder", async () => {
    prisma.exerciseSet.create.mockResolvedValue({ id: "exercise-1" });

    await service.createExerciseSet("lecturer-1", {
      title: "  章节测验  ",
      questions: [
        {
          type: "true_false",
          promptJson: { text: "这是一道判断题" },
          answerJson: true,
          score: 2,
        },
      ],
    });

    expect(prisma.exerciseSet.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: "章节测验",
          createdById: "lecturer-1",
        }),
      }),
    );
    expect(prisma.exerciseSet.create.mock.calls[0][0].data).not.toHaveProperty(
      "fileId",
    );
  });

  it("reveals correct answers after a learner has submitted when enabled", async () => {
    prisma.exerciseSet.findUnique.mockResolvedValue({
      id: "exercise-1",
      fileId: null,
      title: "练习",
      createdById: "teacher-1",
      viewers: [{ userId: "learner-1" }],
      showAnswerAfterSubmit: true,
      submissions: [{ id: "submission-1" }],
      questions: [
        {
          id: "question-1",
          promptJson: { text: "题目" },
          answerJson: "A",
        },
      ],
    });

    const result = await service.getExerciseSet("learner-1", "exercise-1");

    expect(result.questions[0]).toHaveProperty("answerJson", "A");
  });

  it("rechecks single-submission eligibility inside a serializable transaction", async () => {
    prisma.exerciseSet.findUnique.mockResolvedValue({
      id: "exercise-1",
      fileId: null,
      title: "练习",
      createdById: "teacher-1",
      viewers: [{ userId: "learner-1" }],
      openAt: null,
      dueAt: null,
      allowMultipleSubmissions: false,
      submissions: [],
      questions: [
        {
          id: "question-1",
          type: "true_false",
          answerJson: true,
          score: 2,
        },
      ],
    });
    const transaction = {
      submission: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue({
          id: "submission-1",
          answers: [],
        }),
      },
    };
    prisma.$transaction.mockImplementation((callback) => callback(transaction));

    await service.submitExercise("learner-1", "exercise-1", {
      answers: [{ questionId: "question-1", answerJson: true }],
    });

    expect(transaction.submission.count).toHaveBeenCalledWith({
      where: { exerciseSetId: "exercise-1", userId: "learner-1" },
    });
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ isolationLevel: "Serializable" }),
    );
  });

  it("rejects grading an answer that belongs to another submission", async () => {
    prisma.submission.findUnique.mockResolvedValue({
      id: "submission-1",
      exerciseSet: { createdById: "lecturer-1" },
      answers: [{ id: "answer-1", question: { score: 5 }, score: null }],
    });

    await expect(
      service.gradeSubmission("lecturer-1", "submission-1", {
        answers: [{ answerId: "answer-2", score: 3 }],
      }),
    ).rejects.toThrow("批改中包含不属于该提交的答案");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects a score higher than the question maximum", async () => {
    prisma.submission.findUnique.mockResolvedValue({
      id: "submission-1",
      exerciseSet: { createdById: "lecturer-1" },
      answers: [{ id: "answer-1", question: { score: 5 }, score: null }],
    });

    await expect(
      service.gradeSubmission("lecturer-1", "submission-1", {
        answers: [{ answerId: "answer-1", score: 6 }],
      }),
    ).rejects.toThrow("单题得分不能超过 5 分");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
