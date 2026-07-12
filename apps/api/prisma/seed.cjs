const argon2 = require("argon2");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function upsertUser({ username, displayName, systemRole, password }) {
  const passwordHash = await argon2.hash(password);

  return prisma.user.upsert({
    where: { username },
    update: {
      displayName,
      systemRole,
      status: "active",
    },
    create: {
      username,
      displayName,
      systemRole,
      passwordHash,
    },
  });
}

async function upsertPermissionGroup({
  workspaceId,
  name,
  createdById,
  description,
}) {
  return prisma.permissionGroup.upsert({
    where: { workspaceId_name: { workspaceId, name } },
    update: { description: description ?? null },
    create: {
      workspaceId,
      name,
      description: description ?? null,
      createdById,
    },
  });
}

async function upsertForumCategory({
  workspaceId,
  name,
  description,
  sortOrder,
}) {
  return prisma.forumCategory.upsert({
    where: { workspaceId_name: { workspaceId, name } },
    update: {
      description: description ?? null,
      sortOrder,
    },
    create: {
      workspaceId,
      name,
      description: description ?? null,
      sortOrder,
    },
  });
}

async function addGroupMember(groupId, userId) {
  await prisma.permissionGroupMember.upsert({
    where: { groupId_userId: { groupId, userId } },
    update: {},
    create: { groupId, userId },
  });
}

async function main() {
  const admin = await upsertUser({
    username: "admin",
    displayName: "Admin",
    systemRole: "admin",
    password: "liveboard-admin",
  });

  const author = await upsertUser({
    username: "author",
    displayName: "Author",
    systemRole: "member",
    password: "liveboard-author",
  });

  const lecturer = await upsertUser({
    username: "lecturer",
    displayName: "Lecturer",
    systemRole: "member",
    password: "liveboard-lecturer",
  });

  const learner = await upsertUser({
    username: "learner",
    displayName: "Learner",
    systemRole: "member",
    password: "liveboard-learner",
  });

  const workspace = await prisma.workspace.upsert({
    where: { slug: "default" },
    update: { name: "LiveBoard", timeZone: "Asia/Shanghai" },
    create: {
      name: "LiveBoard",
      slug: "default",
      timeZone: "Asia/Shanghai",
    },
  });

  await upsertForumCategory({
    workspaceId: workspace.id,
    name: "公告与答疑",
    description: "课程通知、平台问题和高频答疑。",
    sortOrder: 10,
  });
  await upsertForumCategory({
    workspaceId: workspace.id,
    name: "课程讨论",
    description: "围绕课程内容、作业思路和课堂延伸展开讨论。",
    sortOrder: 20,
  });
  await upsertForumCategory({
    workspaceId: workspace.id,
    name: "资源反馈",
    description: "反馈资料错误、缺失内容和阅读体验问题。",
    sortOrder: 30,
  });

  const adminGroup = await upsertPermissionGroup({
    workspaceId: workspace.id,
    name: "管理员",
    description: "系统最高权限成员",
    createdById: admin.id,
  });
  const authorGroup = await upsertPermissionGroup({
    workspaceId: workspace.id,
    name: "作者",
    description: "可维护课程资料和模板",
    createdById: admin.id,
  });
  const lecturerGroup = await upsertPermissionGroup({
    workspaceId: workspace.id,
    name: "讲师",
    description: "可授课和查看发布资料",
    createdById: admin.id,
  });
  const learnerGroup = await upsertPermissionGroup({
    workspaceId: workspace.id,
    name: "学习者",
    description: "默认学习访问范围",
    createdById: admin.id,
  });

  await addGroupMember(adminGroup.id, admin.id);
  await addGroupMember(authorGroup.id, author.id);
  await addGroupMember(lecturerGroup.id, lecturer.id);
  await addGroupMember(learnerGroup.id, learner.id);

  const publicFolder = await prisma.folder.upsert({
    where: { id: "seed_folder_public" },
    update: { name: "公共资料" },
    create: {
      id: "seed_folder_public",
      workspaceId: workspace.id,
      name: "公共资料",
      sortOrder: 10,
      createdById: admin.id,
    },
  });

  const templatesFolder = await prisma.folder.upsert({
    where: { id: "seed_folder_templates" },
    update: { name: "课程模板" },
    create: {
      id: "seed_folder_templates",
      workspaceId: workspace.id,
      parentId: publicFolder.id,
      name: "课程模板",
      sortOrder: 20,
      createdById: admin.id,
    },
  });

  const courseFolder = await prisma.folder.upsert({
    where: { id: "seed_folder_courses" },
    update: { name: "本周授课" },
    create: {
      id: "seed_folder_courses",
      workspaceId: workspace.id,
      name: "本周授课",
      sortOrder: 30,
      createdById: admin.id,
    },
  });

  await prisma.permissionGrant.deleteMany({
    where: {
      targetId: {
        in: [
          workspace.id,
          publicFolder.id,
          templatesFolder.id,
          courseFolder.id,
        ],
      },
      userId: { in: [admin.id, author.id, lecturer.id, learner.id] },
    },
  });

  const grants = [
    {
      targetType: "workspace",
      targetId: workspace.id,
      groupId: adminGroup.id,
      level: "owner",
    },
    {
      targetType: "folder",
      targetId: publicFolder.id,
      groupId: learnerGroup.id,
      level: "viewer",
    },
    {
      targetType: "folder",
      targetId: templatesFolder.id,
      groupId: authorGroup.id,
      level: "editor",
    },
    {
      targetType: "folder",
      targetId: courseFolder.id,
      groupId: lecturerGroup.id,
      level: "lecturer",
    },
    {
      targetType: "folder",
      targetId: publicFolder.id,
      groupId: lecturerGroup.id,
      level: "lecturer",
    },
  ];

  for (const grant of grants) {
    await prisma.permissionGrant.upsert({
      where: {
        targetType_targetId_groupId: {
          targetType: grant.targetType,
          targetId: grant.targetId,
          groupId: grant.groupId,
        },
      },
      update: { level: grant.level },
      create: {
        workspaceId: workspace.id,
        createdById: admin.id,
        ...grant,
      },
    });
  }

  const handbookFile = await prisma.file.upsert({
    where: { id: "seed_file_handbook" },
    update: {
      title: "入门手册",
      status: "published",
    },
    create: {
      id: "seed_file_handbook",
      workspaceId: workspace.id,
      folderId: publicFolder.id,
      type: "book",
      title: "入门手册",
      status: "published",
      createdById: admin.id,
      updatedById: admin.id,
      publishedAt: new Date(),
    },
  });

  await prisma.file.upsert({
    where: { id: "seed_file_lesson_1" },
    update: {
      title: "第一讲教案",
    },
    create: {
      id: "seed_file_lesson_1",
      workspaceId: workspace.id,
      folderId: templatesFolder.id,
      type: "lesson",
      title: "第一讲教案",
      createdById: author.id,
      updatedById: author.id,
    },
  });

  await prisma.contentBlock.deleteMany({
    where: { fileId: handbookFile.id },
  });

  await prisma.contentBlock.createMany({
    data: [
      {
        fileId: handbookFile.id,
        type: "heading_1",
        sortOrder: 10,
        dataJson: { text: "LiveBoard 入门手册" },
        createdById: admin.id,
        updatedById: admin.id,
      },
      {
        fileId: handbookFile.id,
        type: "paragraph",
        sortOrder: 20,
        dataJson: {
          text: "这里用于沉淀长期资料、标准流程和可复用教学内容。",
        },
        createdById: admin.id,
        updatedById: admin.id,
      },
      {
        fileId: handbookFile.id,
        type: "code",
        sortOrder: 30,
        dataJson: {
          language: "bash",
          text: "pnpm dev",
        },
        createdById: admin.id,
        updatedById: admin.id,
      },
    ],
  });

  const exerciseFile = await prisma.file.upsert({
    where: { id: "seed_file_exercise_basics" },
    update: {
      title: "基础概念测验",
      status: "published",
    },
    create: {
      id: "seed_file_exercise_basics",
      workspaceId: workspace.id,
      folderId: publicFolder.id,
      type: "exercise_set",
      title: "基础概念测验",
      status: "published",
      createdById: lecturer.id,
      updatedById: lecturer.id,
      publishedAt: new Date(),
    },
  });

  const exerciseSet = await prisma.exerciseSet.upsert({
    where: { fileId: exerciseFile.id },
    update: {
      allowMultipleSubmissions: true,
      showAnswerAfterSubmit: false,
    },
    create: {
      fileId: exerciseFile.id,
      allowMultipleSubmissions: true,
      showAnswerAfterSubmit: false,
    },
  });

  await prisma.submissionAnswer.deleteMany({
    where: {
      question: {
        exerciseSetId: exerciseSet.id,
      },
    },
  });

  await prisma.submission.deleteMany({
    where: { exerciseSetId: exerciseSet.id },
  });

  await prisma.question.deleteMany({
    where: { exerciseSetId: exerciseSet.id },
  });

  await prisma.question.createMany({
    data: [
      {
        exerciseSetId: exerciseSet.id,
        type: "single_choice",
        promptJson: { text: "LiveBoard 首版采用哪种账号模式？" },
        optionsJson: {
          options: ["管理员代建账号", "公开注册", "第三方 OAuth", "匿名访问"],
        },
        answerJson: "管理员代建账号",
        score: 5,
        sortOrder: 10,
      },
      {
        exerciseSetId: exerciseSet.id,
        type: "multiple_choice",
        promptJson: { text: "文件夹权限模型包含哪些能力？" },
        optionsJson: {
          options: ["继承权限", "显式覆盖", "no_access 拒绝", "公开搜索"],
        },
        answerJson: ["继承权限", "显式覆盖", "no_access 拒绝"],
        score: 8,
        sortOrder: 20,
      },
      {
        exerciseSetId: exerciseSet.id,
        type: "short_answer",
        promptJson: { text: "简述为什么授课内容引用默认采用 snapshot。" },
        optionsJson: null,
        answerJson: null,
        score: 10,
        sortOrder: 30,
      },
    ],
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
