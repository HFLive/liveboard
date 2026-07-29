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
import { requireResourceName } from "../../common/resource-name";
import { PrismaService } from "../prisma/prisma.service";
import { ClassroomsService } from "../classrooms/classrooms.service";
import { NotificationsService } from "../notifications/notifications.service";
import type {
  CreateExerciseSetDto,
  GradeSubmissionDto,
  SubmitExerciseDto,
  UpdateExerciseSetDto,
} from "./exercises.dto";

@Injectable()
export class ExercisesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly classrooms: ClassroomsService,
    private readonly notifications: NotificationsService,
  ) {}

  async listExerciseSets(userId: string | null, classroomId?: string) {
    const user = await this.requireUser(userId);

    const [exerciseSets, pendingCounts] = await Promise.all([
      this.prisma.exerciseSet.findMany({
        where: {
          ...(classroomId ? { classroomId } : {}),
          ...(isSystemAdmin(user.systemRole)
            ? {}
            : { classroom: { members: { some: { userId: user.id } } } }),
        },
        include: {
          createdBy: {
            include: {
              badgeAssignments: {
                where: { equippedOrder: { not: null } },
                include: { badge: true },
                orderBy: { equippedOrder: "asc" },
                take: 3,
              },
            },
          },
          classroom: {
            include: {
              members: { where: { userId: user.id }, select: { role: true } },
            },
          },
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
        classroomId: exerciseSet.classroomId,
        classroomName: exerciseSet.classroom.name,
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
          badges: exerciseSet.createdBy.badgeAssignments?.map(({ badge }) => ({
            id: badge.id,
            name: badge.name,
            description: badge.description,
            color: normalizeBadgeColor(badge.color),
          })),
        },
        questionCount: exerciseSet._count.questions,
        canManage: exerciseSet.classroom.members[0]?.role === "teacher",
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
    await this.classrooms.requireTeacher(user, input.classroomId);

    const title = requireResourceName(input.title, "练习名称");

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

    return this.prisma.$transaction(async (transaction) => {
      const classroom = await transaction.classroom.findUnique({
        where: { id: input.classroomId },
        select: {
          members: {
            where: { role: "student" },
            select: { userId: true },
          },
        },
      });
      if (!classroom) throw new NotFoundException("课堂不存在");
      const exercise = await transaction.exerciseSet.create({
        data: {
          classroomId: input.classroomId,
          title,
          createdById: user.id,
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
              required: question.required ?? true,
              sortOrder: index,
            })),
          },
        },
        include: { questions: true },
      });
      await this.notifications.create(
        {
          type: "exercise_published",
          category: "task",
          priority: "important",
          actorId: user.id,
          classroomId: input.classroomId,
          targetType: "exercise",
          targetId: exercise.id,
          title: `新练习：${title}`,
          detail: dueAt
            ? `新练习已发布 · ${dueAt.toLocaleString("zh-CN", {
                month: "numeric",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })} 截止`
            : "新练习已发布",
          href: `/app/exercises/${encodeURIComponent(exercise.id)}`,
          recipientIds: classroom.members.map(({ userId: id }) => id),
        },
        transaction,
      );
      return exercise;
    });
  }

  async updateExerciseSet(
    userId: string | null,
    exerciseSetId: string,
    input: UpdateExerciseSetDto,
  ) {
    const user = await this.requireUser(userId);
    const existing = await this.prisma.exerciseSet.findUnique({
      where: { id: exerciseSetId },
      select: {
        classroomId: true,
        _count: { select: { submissions: true } },
      },
    });
    if (!existing) throw new NotFoundException("Exercise set not found");
    await this.classrooms.requireTeacher(user, existing.classroomId);
    if (existing._count.submissions > 0) {
      throw new ConflictException("已有学生提交，不能再修改练习题目");
    }

    const title = requireResourceName(input.title, "练习名称");
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

    return this.prisma.$transaction(async (transaction) => {
      await transaction.question.deleteMany({ where: { exerciseSetId } });
      return transaction.exerciseSet.update({
        where: { id: exerciseSetId },
        data: {
          title,
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
              required: question.required ?? true,
              sortOrder: index,
            })),
          },
        },
        include: { questions: true },
      });
    });
  }

  async getExerciseSet(userId: string | null, exerciseSetId: string) {
    const user = await this.requireUser(userId);

    const exerciseSet = await this.prisma.exerciseSet.findUnique({
      where: { id: exerciseSetId },
      include: {
        classroom: {
          include: {
            members: { select: { userId: true, role: true } },
          },
        },
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
      !isSystemAdmin(user.systemRole) &&
      exerciseSet.classroom.members.length === 0
    ) {
      throw new ForbiddenException("No permission to view exercise set");
    }

    const canSeeAnswers =
      exerciseSet.classroom.members[0]?.role === "teacher" ||
      isSystemAdmin(user.systemRole) ||
      (exerciseSet.showAnswerAfterSubmit && exerciseSet.submissions.length > 0);
    const {
      submissions: _submissions,
      classroom,
      ...exerciseSetWithoutSubmissions
    } = exerciseSet;
    const detail = {
      ...exerciseSetWithoutSubmissions,
      classroomName: classroom.name,
      canManage: classroom.members[0]?.role === "teacher",
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

  async submitExercise(
    userId: string | null,
    exerciseSetId: string,
    input: SubmitExerciseDto,
  ) {
    const user = await this.requireUser(userId);

    const exerciseSet = await this.prisma.exerciseSet.findUnique({
      where: { id: exerciseSetId },
      include: {
        classroom: {
          include: {
            members: { select: { userId: true, role: true } },
          },
        },
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
      exerciseSet.classroom.members.find((member) => member.userId === user.id)
        ?.role !== "student"
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
    const unansweredRequired = exerciseSet.questions.find((question) => {
      if (!question.required) return false;
      const value = answerMap.get(question.id)?.answerJson;
      return (
        value === null ||
        value === undefined ||
        value === "" ||
        (Array.isArray(value) && value.length === 0)
      );
    });
    if (unansweredRequired) {
      throw new BadRequestException("请完成所有必答题后再提交");
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
            const submission = await tx.submission.create({
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
            await this.notifications.create(
              {
                type: "submission_received",
                category: "task",
                priority: needsManualReview ? "important" : "normal",
                actorId: user.id,
                classroomId: exerciseSet.classroomId,
                targetType: "exercise",
                targetId: exerciseSet.id,
                title: exerciseSet.title,
                detail: `${user.displayName}提交了练习`,
                href: `/app/exercises/${encodeURIComponent(exerciseSet.id)}/submissions`,
                recipientIds: exerciseSet.classroom.members
                  .filter(({ role }) => role === "teacher")
                  .map(({ userId: id }) => id),
                groupKey: `submission:${exerciseSet.id}`,
                groupWindowMs: 10 * 60 * 1000,
                aggregatedDetail: "有 {count} 份新提交等待查看",
              },
              tx,
            );
            return submission;
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
      include: {
        classroom: {
          include: {
            members: { where: { userId: user.id }, select: { role: true } },
          },
        },
      },
    });

    if (!exerciseSet) {
      throw new NotFoundException("Exercise set not found");
    }

    if (exerciseSet.classroom.members[0]?.role !== "teacher") {
      throw new ForbiddenException("No permission to list submissions");
    }

    return this.prisma.submission.findMany({
      where: { exerciseSetId },
      include: {
        user: {
          include: {
            badgeAssignments: {
              where: { equippedOrder: { not: null } },
              include: { badge: true },
              orderBy: { equippedOrder: "asc" },
              take: 3,
            },
          },
        },
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
        classroom: {
          include: {
            members: { where: { userId: user.id }, select: { role: true } },
          },
        },
      },
    });

    if (!exerciseSet) {
      throw new NotFoundException("Exercise set not found");
    }

    if (
      !isSystemAdmin(user.systemRole) &&
      exerciseSet.classroom.members.length === 0
    ) {
      throw new ForbiddenException("No permission to view submissions");
    }

    const submissions = await this.prisma.submission.findMany({
      where: { exerciseSetId, userId: user.id },
      include: {
        user: {
          include: {
            badgeAssignments: {
              where: { equippedOrder: { not: null } },
              include: { badge: true },
              orderBy: { equippedOrder: "asc" },
              take: 3,
            },
          },
        },
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
        exerciseSet: {
          include: {
            classroom: {
              include: {
                members: {
                  where: { userId: user.id },
                  select: { role: true },
                },
              },
            },
          },
        },
        answers: { include: { question: true } },
      },
    });

    if (!submission) {
      throw new NotFoundException("Submission not found");
    }

    if (submission.exerciseSet.classroom.members[0]?.role !== "teacher") {
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

      const graded = await transaction.submission.update({
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
      await this.notifications.create(
        {
          type: "submission_graded",
          category: "feedback",
          priority: "important",
          actorId: user.id,
          classroomId: submission.exerciseSet.classroomId,
          targetType: "exercise",
          targetId: submission.exerciseSet.id,
          title: submission.exerciseSet.title,
          detail: `批改已完成 · ${totalScore}/${submission.maxScore} 分`,
          href: `/app/exercises/${encodeURIComponent(submission.exerciseSet.id)}`,
          recipientIds: [submission.userId],
        },
        transaction,
      );
      return graded;
    });
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

function normalizeBadgeColor(value: string) {
  return ["gold", "blue", "green", "purple", "red", "gray"].includes(value)
    ? (value as "gold" | "blue" | "green" | "purple" | "red" | "gray")
    : ("gray" as const);
}
