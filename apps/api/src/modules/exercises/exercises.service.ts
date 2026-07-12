import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { gradeQuestion, canLecture, canView } from "@liveboard/shared";
import type { QuestionType } from "@liveboard/shared";
import type { Prisma } from "@prisma/client";
import { PermissionsService } from "../permissions/permissions.service";
import { PrismaService } from "../prisma/prisma.service";
import type {
  CreateExerciseSetDto,
  GradeSubmissionDto,
  SubmitExerciseDto,
} from "./exercises.dto";

@Injectable()
export class ExercisesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
  ) {}

  async listExerciseSets(userId: string | null) {
    if (!userId) {
      throw new UnauthorizedException("Missing session");
    }

    const exerciseSets = await this.prisma.exerciseSet.findMany({
      include: {
        file: true,
        questions: {
          select: { id: true },
        },
        submissions: {
          select: {
            id: true,
            userId: true,
            status: true,
            score: true,
            maxScore: true,
            submittedAt: true,
          },
          orderBy: { submittedAt: "desc" },
        },
      },
      orderBy: { updatedAt: "desc" },
    });

    const visible = [];

    for (const exerciseSet of exerciseSets) {
      const level = await this.permissions.getEffectiveLevelForFile(
        userId,
        exerciseSet.fileId,
      );

      if (!canView(level)) {
        continue;
      }

      const latestSubmission = exerciseSet.submissions.find(
        (submission) => submission.userId === userId,
      );
      const pendingReviewCount = exerciseSet.submissions.filter((submission) =>
        ["submitted", "needs_manual_review"].includes(submission.status),
      ).length;

      visible.push({
        id: exerciseSet.id,
        fileId: exerciseSet.fileId,
        title: exerciseSet.file.title,
        questionCount: exerciseSet.questions.length,
        canManage: canLecture(level),
        submissionCount: exerciseSet.submissions.length,
        pendingReviewCount,
        openAt: exerciseSet.openAt?.toISOString() ?? null,
        dueAt: exerciseSet.dueAt?.toISOString() ?? null,
        updatedAt: exerciseSet.updatedAt.toISOString(),
        latestSubmissionStatus: latestSubmission?.status ?? "not_started",
        latestScore: latestSubmission?.score ?? null,
        maxScore: latestSubmission?.maxScore ?? null,
      });
    }

    return visible;
  }

  async createExerciseSet(userId: string | null, input: CreateExerciseSetDto) {
    if (!userId) {
      throw new UnauthorizedException("Missing session");
    }

    const title = input.title.trim();
    if (!title) {
      throw new BadRequestException("测验名称不能为空");
    }

    const openAt = input.openAt ? new Date(input.openAt) : null;
    const dueAt = input.dueAt ? new Date(input.dueAt) : null;

    if (openAt && Number.isNaN(openAt.getTime())) {
      throw new BadRequestException("开始时间无效");
    }

    if (dueAt && Number.isNaN(dueAt.getTime())) {
      throw new BadRequestException("截止时间无效");
    }

    if (openAt && dueAt && dueAt <= openAt) {
      throw new BadRequestException("截止时间必须晚于开始时间");
    }

    input.questions.forEach((question, index) => {
      this.validateQuestion(question, index);
    });

    const folders = await this.prisma.folder.findMany({
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    let targetFolder: (typeof folders)[number] | null = null;

    for (const folder of folders) {
      const level = await this.permissions.getEffectiveLevelForFolder(
        userId,
        folder.id,
      );
      if (canLecture(level)) {
        targetFolder = folder;
        break;
      }
    }

    if (!targetFolder) {
      throw new ForbiddenException("没有可用于创建测验的空间");
    }

    return this.prisma.$transaction(async (transaction) => {
      const file = await transaction.file.create({
        data: {
          workspaceId: targetFolder.workspaceId,
          folderId: targetFolder.id,
          type: "exercise_set",
          title,
          createdById: userId,
          updatedById: userId,
        },
      });

      return transaction.exerciseSet.create({
        data: {
          fileId: file.id,
          openAt,
          dueAt,
          allowMultipleSubmissions: input.allowMultipleSubmissions ?? false,
          showAnswerAfterSubmit: input.showAnswerAfterSubmit ?? false,
          questions: {
            create: input.questions.map((question, index) => ({
              type: question.type,
              promptJson: question.promptJson as Prisma.InputJsonValue,
              optionsJson: question.optionsJson as Prisma.InputJsonValue,
              answerJson: question.answerJson as Prisma.InputJsonValue,
              score: question.score,
              sortOrder: index,
            })),
          },
        },
        include: { questions: true },
      });
    });
  }

  async getExerciseSet(userId: string | null, exerciseSetId: string) {
    if (!userId) {
      throw new UnauthorizedException("Missing session");
    }

    const exerciseSet = await this.prisma.exerciseSet.findUnique({
      where: { id: exerciseSetId },
      include: {
        file: true,
        questions: {
          orderBy: { sortOrder: "asc" },
        },
        submissions: {
          where: { userId },
          select: { id: true },
          take: 1,
        },
      },
    });

    if (!exerciseSet) {
      throw new NotFoundException("Exercise set not found");
    }

    const level = await this.permissions.getEffectiveLevelForFile(
      userId,
      exerciseSet.fileId,
    );

    if (!canView(level)) {
      throw new ForbiddenException("No permission to view exercise set");
    }

    const canSeeAnswers =
      canLecture(level) ||
      (exerciseSet.showAnswerAfterSubmit && exerciseSet.submissions.length > 0);
    const { submissions: _submissions, ...exerciseSetWithoutSubmissions } =
      exerciseSet;

    if (!canSeeAnswers) {
      return {
        ...exerciseSetWithoutSubmissions,
        questions: exerciseSet.questions.map(
          ({ answerJson: _answerJson, ...question }) => question,
        ),
      };
    }

    return exerciseSetWithoutSubmissions;
  }

  async submitExercise(
    userId: string | null,
    exerciseSetId: string,
    input: SubmitExerciseDto,
  ) {
    if (!userId) {
      throw new UnauthorizedException("Missing session");
    }

    const exerciseSet = await this.prisma.exerciseSet.findUnique({
      where: { id: exerciseSetId },
      include: {
        file: true,
        questions: true,
        submissions: {
          where: { userId },
          select: { id: true },
        },
      },
    });

    if (!exerciseSet) {
      throw new NotFoundException("Exercise set not found");
    }

    const level = await this.permissions.getEffectiveLevelForFile(
      userId,
      exerciseSet.fileId,
    );

    if (!canView(level)) {
      throw new ForbiddenException("No permission to submit exercise");
    }

    const now = new Date();

    if (exerciseSet.openAt && exerciseSet.openAt > now) {
      throw new ForbiddenException("练习还未开始");
    }

    if (exerciseSet.dueAt && exerciseSet.dueAt < now) {
      throw new ForbiddenException("练习已截止");
    }

    if (
      !exerciseSet.allowMultipleSubmissions &&
      exerciseSet.submissions.length > 0
    ) {
      throw new ForbiddenException("Multiple submissions are not allowed");
    }

    const answerMap = new Map(
      input.answers.map((answer) => [answer.questionId, answer]),
    );

    if (answerMap.size !== input.answers.length) {
      throw new BadRequestException("同一道题不能重复提交答案");
    }

    const questionIds = new Set(
      exerciseSet.questions.map((question) => question.id),
    );
    const unknownQuestion = input.answers.find(
      (answer) => !questionIds.has(answer.questionId),
    );
    if (unknownQuestion) {
      throw new BadRequestException("提交中包含不属于该练习的题目");
    }
    let totalScore = 0;
    let needsManualReview = false;
    const maxScore = exerciseSet.questions.reduce(
      (sum, question) => sum + question.score,
      0,
    );

    const answerCreates = exerciseSet.questions.map((question) => {
      const submitted = answerMap.get(question.id);
      const result = gradeQuestion({
        type: question.type as QuestionType,
        expectedAnswer: question.answerJson,
        submittedAnswer: submitted?.answerJson ?? null,
        score: question.score,
      });

      if (!result.autoGraded) {
        needsManualReview = true;
      } else {
        totalScore += result.score ?? 0;
      }

      return {
        questionId: question.id,
        answerJson: (submitted?.answerJson ?? null) as Prisma.InputJsonValue,
        score: result.score,
        autoGraded: result.autoGraded,
      };
    });

    return this.prisma.submission.create({
      data: {
        exerciseSetId,
        userId,
        status: needsManualReview ? "needs_manual_review" : "auto_graded",
        score: needsManualReview ? null : totalScore,
        maxScore,
        submittedAt: new Date(),
        answers: {
          create: answerCreates,
        },
      },
      include: { answers: true },
    });
  }

  async listSubmissions(userId: string | null, exerciseSetId: string) {
    if (!userId) {
      throw new UnauthorizedException("Missing session");
    }

    const exerciseSet = await this.prisma.exerciseSet.findUnique({
      where: { id: exerciseSetId },
      include: { file: true },
    });

    if (!exerciseSet) {
      throw new NotFoundException("Exercise set not found");
    }

    const level = await this.permissions.getEffectiveLevelForFile(
      userId,
      exerciseSet.fileId,
    );

    if (!canLecture(level)) {
      throw new ForbiddenException("No permission to list submissions");
    }

    return this.prisma.submission.findMany({
      where: { exerciseSetId },
      include: {
        user: true,
        answers: {
          include: {
            question: {
              select: {
                id: true,
                type: true,
                promptJson: true,
                optionsJson: true,
                answerJson: true,
                score: true,
                sortOrder: true,
              },
            },
          },
          orderBy: {
            question: {
              sortOrder: "asc",
            },
          },
        },
      },
      orderBy: { submittedAt: "desc" },
    });
  }

  async listMySubmissions(userId: string | null, exerciseSetId: string) {
    if (!userId) {
      throw new UnauthorizedException("Missing session");
    }

    const exerciseSet = await this.prisma.exerciseSet.findUnique({
      where: { id: exerciseSetId },
      include: { file: true },
    });

    if (!exerciseSet) {
      throw new NotFoundException("Exercise set not found");
    }

    const level = await this.permissions.getEffectiveLevelForFile(
      userId,
      exerciseSet.fileId,
    );

    if (!canView(level)) {
      throw new ForbiddenException("No permission to view submissions");
    }

    const submissions = await this.prisma.submission.findMany({
      where: { exerciseSetId, userId },
      include: {
        user: true,
        answers: {
          include: {
            question: {
              select: {
                id: true,
                type: true,
                promptJson: true,
                optionsJson: true,
                answerJson: true,
                score: true,
                sortOrder: true,
              },
            },
          },
          orderBy: {
            question: {
              sortOrder: "asc",
            },
          },
        },
      },
      orderBy: { submittedAt: "desc" },
    });

    if (exerciseSet.showAnswerAfterSubmit) {
      return submissions;
    }

    return submissions.map((submission) => ({
      ...submission,
      answers: submission.answers.map((answer) => ({
        ...answer,
        question: answer.question
          ? (({ answerJson: _answerJson, ...question }) => question)(
              answer.question,
            )
          : answer.question,
      })),
    }));
  }

  async gradeSubmission(
    userId: string | null,
    submissionId: string,
    input: GradeSubmissionDto,
  ) {
    if (!userId) {
      throw new UnauthorizedException("Missing session");
    }

    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      include: {
        exerciseSet: { include: { file: true } },
        answers: { include: { question: true } },
      },
    });

    if (!submission) {
      throw new NotFoundException("Submission not found");
    }

    const level = await this.permissions.getEffectiveLevelForFile(
      userId,
      submission.exerciseSet.fileId,
    );

    if (!canLecture(level)) {
      throw new ForbiddenException("No permission to grade submission");
    }

    const answerById = new Map(
      submission.answers.map((answer) => [answer.id, answer]),
    );

    if (
      input.answers.length !== submission.answers.length ||
      new Set(input.answers.map((answer) => answer.answerId)).size !==
        input.answers.length
    ) {
      throw new BadRequestException("请完整批阅每一道题");
    }

    for (const answer of input.answers) {
      const storedAnswer = answerById.get(answer.answerId);
      if (!storedAnswer) {
        throw new BadRequestException("批阅中包含不属于该提交的答案");
      }

      if (answer.score > storedAnswer.question.score) {
        throw new BadRequestException(
          `单题得分不能超过 ${storedAnswer.question.score} 分`,
        );
      }
    }

    return this.prisma.$transaction(async (transaction) => {
      for (const answer of input.answers) {
        await transaction.submissionAnswer.update({
          where: { id: answer.answerId },
          data: {
            score: answer.score,
            feedback: answer.feedback?.trim() || null,
            autoGraded: false,
          },
        });
      }

      const totalScore = input.answers.reduce(
        (sum, answer) => sum + answer.score,
        0,
      );

      return transaction.submission.update({
        where: { id: submissionId },
        data: {
          status: "graded",
          score: totalScore,
          feedback: input.feedback?.trim() || null,
          gradedById: userId,
          gradedAt: new Date(),
        },
        include: { answers: true },
      });
    });
  }

  private validateQuestion(
    question: CreateExerciseSetDto["questions"][number],
    index: number,
  ) {
    const label = `第 ${index + 1} 题`;
    const prompt = question.promptJson?.text;
    if (typeof prompt !== "string" || !prompt.trim()) {
      throw new BadRequestException(`${label}缺少题干`);
    }

    if (question.type === "short_answer") {
      return;
    }

    if (question.type === "true_false") {
      if (typeof question.answerJson !== "boolean") {
        throw new BadRequestException(`${label}的判断题答案无效`);
      }
      return;
    }

    if (question.type === "fill_blank") {
      if (
        typeof question.answerJson !== "string" ||
        !question.answerJson.trim()
      ) {
        throw new BadRequestException(`${label}缺少标准答案`);
      }
      return;
    }

    const optionsValue = question.optionsJson as
      { options?: unknown } | undefined;
    const options = Array.isArray(optionsValue?.options)
      ? optionsValue.options.filter(
          (option): option is string =>
            typeof option === "string" && Boolean(option.trim()),
        )
      : [];
    const normalizedOptions = options.map((option) => option.trim());

    if (
      normalizedOptions.length < 2 ||
      new Set(normalizedOptions).size !== normalizedOptions.length
    ) {
      throw new BadRequestException(`${label}需要至少两个不重复的选项`);
    }

    const submittedAnswers = Array.isArray(question.answerJson)
      ? question.answerJson
      : [question.answerJson];
    if (
      submittedAnswers.length === 0 ||
      submittedAnswers.some(
        (answer) =>
          typeof answer !== "string" ||
          !normalizedOptions.includes(answer.trim()),
      )
    ) {
      throw new BadRequestException(`${label}的标准答案必须来自题目选项`);
    }

    if (question.type === "single_choice" && submittedAnswers.length !== 1) {
      throw new BadRequestException(`${label}只能设置一个标准答案`);
    }
  }
}
