import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { gradeQuestion, isSuperAdmin, isSystemAdmin } from "@liveboard/shared";
import type { QuestionType } from "@liveboard/shared";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type {
  CreateExerciseSetDto,
  GradeSubmissionDto,
  SubmitExerciseDto,
} from "./exercises.dto";

@Injectable()
export class ExercisesService {
  constructor(private readonly prisma: PrismaService) {}

  async listExerciseSets(userId: string | null) {
    const user = await this.requireUser(userId);

    const [exerciseSets, pendingCounts] = await Promise.all([
      this.prisma.exerciseSet.findMany({
        where: isSuperAdmin(user.systemRole)
          ? undefined
          : {
              OR: [
                { createdById: user.id },
                { viewers: { some: { userId: user.id } } },
              ],
            },
        include: {
          createdBy: true,
          viewers: { select: { userId: true } },
          _count: { select: { questions: true, submissions: true } },
          submissions: {
            where: { userId: user.id },
            select: {
              status: true,
              score: true,
              maxScore: true,
            },
            orderBy: { submittedAt: "desc" },
            take: 1,
          },
        },
        orderBy: { updatedAt: "desc" },
      }),
      this.prisma.submission.groupBy({
        by: ["exerciseSetId"],
        where: { status: { in: ["submitted", "needs_manual_review"] } },
        _count: { _all: true },
      }),
    ]);
    const pendingByExerciseSet = new Map(
      pendingCounts.map((item) => [item.exerciseSetId, item._count._all]),
    );

    const visible = [];

    for (const exerciseSet of exerciseSets) {
      const latestSubmission = exerciseSet.submissions[0];

      visible.push({
        id: exerciseSet.id,
        fileId: exerciseSet.fileId,
        title: exerciseSet.title,
        createdBy: {
          id: exerciseSet.createdBy.id,
          username: exerciseSet.createdBy.username,
          displayName: exerciseSet.createdBy.displayName,
          avatarUrl: exerciseSet.createdBy.avatarUpdatedAt
            ? `/auth/avatar/${exerciseSet.createdBy.id}?v=${exerciseSet.createdBy.avatarUpdatedAt.getTime()}`
            : null,
          systemRole: exerciseSet.createdBy.systemRole,
          status: exerciseSet.createdBy.status,
        },
        questionCount: exerciseSet._count.questions,
        canManage:
          exerciseSet.createdById === user.id || isSystemAdmin(user.systemRole),
        viaSuperAdmin:
          isSuperAdmin(user.systemRole) &&
          exerciseSet.createdById !== user.id &&
          !exerciseSet.viewers.some((viewer) => viewer.userId === user.id),
        submissionCount: exerciseSet._count.submissions,
        pendingReviewCount: pendingByExerciseSet.get(exerciseSet.id) ?? 0,
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
    const user = await this.requireUser(userId);

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

    const visibleUserIds = await this.normalizeVisibleUserIds(
      user.id,
      input.visibleUserIds,
    );

    return this.prisma.exerciseSet.create({
      data: {
        title,
        createdById: user.id,
        openAt,
        dueAt,
        allowMultipleSubmissions: input.allowMultipleSubmissions ?? false,
        showAnswerAfterSubmit: input.showAnswerAfterSubmit ?? false,
        viewers: {
          create: visibleUserIds.map((viewerUserId) => ({
            userId: viewerUserId,
          })),
        },
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
  }

  async getExerciseSet(userId: string | null, exerciseSetId: string) {
    const user = await this.requireUser(userId);

    const exerciseSet = await this.prisma.exerciseSet.findUnique({
      where: { id: exerciseSetId },
      include: {
        viewers: { select: { userId: true } },
        questions: {
          orderBy: { sortOrder: "asc" },
        },
        submissions: {
          where: { userId: user.id },
          select: { id: true },
          take: 1,
        },
      },
    });

    if (!exerciseSet) {
      throw new NotFoundException("Exercise set not found");
    }

    if (
      !this.canAccessExerciseSet(user, exerciseSet) &&
      !(await this.hasTeachingDeckAccess(user, exerciseSetId))
    ) {
      throw new ForbiddenException("No permission to view exercise set");
    }

    const canSeeAnswers =
      exerciseSet.createdById === user.id ||
      isSystemAdmin(user.systemRole) ||
      (exerciseSet.showAnswerAfterSubmit && exerciseSet.submissions.length > 0);
    const canManageVisibility = exerciseSet.createdById === user.id;
    const {
      submissions: _submissions,
      viewers,
      ...exerciseSetWithoutSubmissions
    } = exerciseSet;
    const detail = {
      ...exerciseSetWithoutSubmissions,
      canManageVisibility,
      visibleUserIds: canManageVisibility
        ? viewers.map((viewer) => viewer.userId)
        : undefined,
    };

    if (!canSeeAnswers) {
      return {
        ...detail,
        questions: exerciseSet.questions.map(
          ({ answerJson: _answerJson, ...question }) => question,
        ),
      };
    }

    return detail;
  }

  async updateVisibility(
    userId: string | null,
    exerciseSetId: string,
    visibleUserIds: string[],
  ) {
    const user = await this.requireUser(userId);
    const exerciseSet = await this.prisma.exerciseSet.findUnique({
      where: { id: exerciseSetId },
    });

    if (!exerciseSet) {
      throw new NotFoundException("Exercise set not found");
    }
    if (exerciseSet.createdById !== user.id) {
      throw new ForbiddenException("只有创建者可以修改可见范围");
    }

    const normalized = await this.normalizeVisibleUserIds(
      exerciseSet.createdById,
      visibleUserIds,
    );
    await this.prisma.$transaction(async (transaction) => {
      await transaction.exerciseSetViewer.deleteMany({
        where: { exerciseSetId },
      });
      await transaction.exerciseSetViewer.createMany({
        data: normalized.map((viewerUserId) => ({
          exerciseSetId,
          userId: viewerUserId,
        })),
      });
    });

    return this.getExerciseSet(user.id, exerciseSetId);
  }

  async submitExercise(
    userId: string | null,
    exerciseSetId: string,
    input: SubmitExerciseDto,
  ) {
    const user = await this.requireUser(userId);

    const exerciseSet = await this.prisma.exerciseSet.findUnique({
      where: { id: exerciseSetId },
      include: {
        viewers: { select: { userId: true } },
        questions: true,
        submissions: {
          where: { userId: user.id },
          select: { id: true },
        },
      },
    });

    if (!exerciseSet) {
      throw new NotFoundException("Exercise set not found");
    }

    if (
      !this.canAccessExerciseSet(user, exerciseSet) &&
      !(await this.hasTeachingDeckAccess(user, exerciseSetId))
    ) {
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

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            if (!exerciseSet.allowMultipleSubmissions) {
              const existing = await tx.submission.count({
                where: { exerciseSetId, userId: user.id },
              });
              if (existing > 0) {
                throw new ForbiddenException(
                  "Multiple submissions are not allowed",
                );
              }
            }
            return tx.submission.create({
              data: {
                exerciseSetId,
                userId: user.id,
                status: needsManualReview
                  ? "needs_manual_review"
                  : "auto_graded",
                score: needsManualReview ? null : totalScore,
                maxScore,
                submittedAt: new Date(),
                answers: { create: answerCreates },
              },
              include: { answers: true },
            });
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (caught) {
        if (
          attempt < 2 &&
          caught instanceof Prisma.PrismaClientKnownRequestError &&
          caught.code === "P2034"
        ) {
          continue;
        }
        throw caught;
      }
    }
    throw new ConflictException("提交同时发生了变化，请重试");
  }

  async listSubmissions(userId: string | null, exerciseSetId: string) {
    const user = await this.requireUser(userId);

    const exerciseSet = await this.prisma.exerciseSet.findUnique({
      where: { id: exerciseSetId },
    });

    if (!exerciseSet) {
      throw new NotFoundException("Exercise set not found");
    }

    if (
      exerciseSet.createdById !== user.id &&
      !isSystemAdmin(user.systemRole)
    ) {
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
    const user = await this.requireUser(userId);

    const exerciseSet = await this.prisma.exerciseSet.findUnique({
      where: { id: exerciseSetId },
      include: {
        viewers: { select: { userId: true } },
      },
    });

    if (!exerciseSet) {
      throw new NotFoundException("Exercise set not found");
    }

    if (
      !this.canAccessExerciseSet(user, exerciseSet) &&
      !(await this.hasTeachingDeckAccess(user, exerciseSetId))
    ) {
      throw new ForbiddenException("No permission to view submissions");
    }

    const submissions = await this.prisma.submission.findMany({
      where: { exerciseSetId, userId: user.id },
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
    const user = await this.requireUser(userId);

    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      include: {
        exerciseSet: true,
        answers: { include: { question: true } },
      },
    });

    if (!submission) {
      throw new NotFoundException("Submission not found");
    }

    if (
      submission.exerciseSet.createdById !== user.id &&
      !isSystemAdmin(user.systemRole)
    ) {
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
      throw new BadRequestException("请完整批改每一道题");
    }

    for (const answer of input.answers) {
      const storedAnswer = answerById.get(answer.answerId);
      if (!storedAnswer) {
        throw new BadRequestException("批改中包含不属于该提交的答案");
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

  private async hasTeachingDeckAccess(
    user: Awaited<ReturnType<ExercisesService["requireUser"]>>,
    exerciseSetId: string,
  ) {
    return (
      (await this.prisma.teachingDeckItem.count({
        where: {
          exerciseSetId,
          ...(isSuperAdmin(user.systemRole)
            ? {}
            : {
                deck: {
                  OR: [
                    { createdById: user.id },
                    { viewers: { some: { userId: user.id } } },
                  ],
                },
              }),
        },
      })) > 0
    );
  }

  private canAccessExerciseSet(
    user: Awaited<ReturnType<ExercisesService["requireUser"]>>,
    exerciseSet: {
      createdById: string;
      viewers: Array<{ userId: string }>;
    },
  ) {
    return (
      isSuperAdmin(user.systemRole) ||
      exerciseSet.createdById === user.id ||
      exerciseSet.viewers.some((viewer) => viewer.userId === user.id)
    );
  }

  private async normalizeVisibleUserIds(
    creatorUserId: string,
    visibleUserIds: string[] | undefined,
  ) {
    const normalized = [...new Set([creatorUserId, ...(visibleUserIds ?? [])])];
    const users = await this.prisma.user.findMany({
      where: { id: { in: normalized }, status: "active" },
      select: { id: true },
    });
    if (users.length !== normalized.length) {
      throw new BadRequestException("可见范围中包含无效用户");
    }
    return normalized;
  }

  private async requireUser(userId: string | null) {
    if (!userId) {
      throw new UnauthorizedException("Missing session");
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.status !== "active") {
      throw new UnauthorizedException("User not found");
    }
    return user;
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
