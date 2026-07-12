import { ExercisesService } from "./exercises.service";
import type { PermissionsService } from "../permissions/permissions.service";
import type { PrismaService } from "../prisma/prisma.service";

describe("ExercisesService", () => {
  const permissions = {
    getEffectiveLevelForFile: jest.fn(),
    getEffectiveLevelForFolder: jest.fn(),
  };
  const prisma = {
    folder: {
      findMany: jest.fn(),
    },
    exerciseSet: {
      create: jest.fn(),
      findUnique: jest.fn(),
    },
    submission: {
      findUnique: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  let service: ExercisesService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new ExercisesService(
      prisma as unknown as PrismaService,
      permissions as unknown as PermissionsService,
    );
  });

  it("does not expose correct answers to a learner before submission", async () => {
    permissions.getEffectiveLevelForFile.mockResolvedValue("viewer");
    prisma.exerciseSet.findUnique.mockResolvedValue({
      id: "exercise-1",
      fileId: "file-1",
      file: { title: "练习" },
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

  it("creates the backing quiz file automatically", async () => {
    const transaction = {
      file: {
        create: jest.fn().mockResolvedValue({ id: "file-1" }),
      },
      exerciseSet: {
        create: jest.fn().mockResolvedValue({ id: "exercise-1" }),
      },
    };
    prisma.folder.findMany.mockResolvedValue([
      { id: "folder-1", workspaceId: "workspace-1" },
    ]);
    permissions.getEffectiveLevelForFolder.mockResolvedValue("lecturer");
    prisma.$transaction.mockImplementation((callback) => callback(transaction));

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

    expect(transaction.file.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        folderId: "folder-1",
        title: "章节测验",
        type: "exercise_set",
      }),
    });
    expect(transaction.exerciseSet.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ fileId: "file-1" }),
      }),
    );
  });

  it("reveals correct answers after a learner has submitted when enabled", async () => {
    permissions.getEffectiveLevelForFile.mockResolvedValue("viewer");
    prisma.exerciseSet.findUnique.mockResolvedValue({
      id: "exercise-1",
      fileId: "file-1",
      file: { title: "练习" },
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

  it("rejects grading an answer that belongs to another submission", async () => {
    permissions.getEffectiveLevelForFile.mockResolvedValue("lecturer");
    prisma.submission.findUnique.mockResolvedValue({
      id: "submission-1",
      exerciseSet: { fileId: "file-1", file: { title: "练习" } },
      answers: [{ id: "answer-1", question: { score: 5 }, score: null }],
    });

    await expect(
      service.gradeSubmission("lecturer-1", "submission-1", {
        answers: [{ answerId: "answer-2", score: 3 }],
      }),
    ).rejects.toThrow("批阅中包含不属于该提交的答案");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects a score higher than the question maximum", async () => {
    permissions.getEffectiveLevelForFile.mockResolvedValue("lecturer");
    prisma.submission.findUnique.mockResolvedValue({
      id: "submission-1",
      exerciseSet: { fileId: "file-1", file: { title: "练习" } },
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
