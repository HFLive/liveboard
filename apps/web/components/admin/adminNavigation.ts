import {
  ArrowLeftRight,
  BadgeCheck,
  Bot,
  CloudCog,
  Database,
  KeyRound,
  LayoutDashboard,
  MessageSquare,
  MonitorCog,
  Settings,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import { APP_ROUTES } from "@/lib/routes";

export const adminOverviewItem = {
  href: APP_ROUTES.admin,
  label: "管理总览",
  description: "全部管理功能",
  icon: LayoutDashboard,
} as const;

export const adminNavGroups = [
  {
    label: "人员与权限",
    description: "成员账号、身份与访问控制。",
    items: [
      {
        href: APP_ROUTES.adminUsers,
        label: "成员管理",
        description: "账号、角色、标签和 AI 限额",
        icon: Users,
      },
      {
        href: APP_ROUTES.adminContentPermissions,
        label: "文档权限",
        description: "设置成员的默认文档权限",
        icon: SlidersHorizontal,
      },
      {
        href: APP_ROUTES.adminBadges,
        label: "徽章管理",
        description: "创建徽章并分配给成员",
        icon: BadgeCheck,
      },
    ],
  },
  {
    label: "内容与资源",
    description: "论坛结构与文件容量。",
    items: [
      {
        href: APP_ROUTES.adminStorage,
        label: "容量管理",
        description: "查看占用并调整容量上限",
        icon: Database,
        superAdminOnly: true,
      },
      {
        href: APP_ROUTES.adminForum,
        label: "版块管理",
        description: "创建、编辑和排序论坛版块",
        icon: MessageSquare,
        superAdminOnly: true,
      },
    ],
  },
  {
    label: "系统与服务",
    description: "AI、存储、运行状态与站点设置。",
    items: [
      {
        href: APP_ROUTES.adminAi,
        label: "AI 服务",
        description: "模型、资料范围和调用限额",
        icon: Bot,
        superAdminOnly: true,
      },
      {
        href: APP_ROUTES.adminStorageBackend,
        label: "存储后端",
        description: "文件存储、上传和下载方式",
        icon: CloudCog,
        superAdminOnly: true,
      },
      {
        href: APP_ROUTES.adminServerStatus,
        label: "运行状态",
        description: "CPU、内存和磁盘用量",
        icon: MonitorCog,
        superAdminOnly: true,
      },
      {
        href: APP_ROUTES.adminSettings,
        label: "系统设置",
        description: "时区、HTTPS 与网站图标",
        icon: Settings,
        superAdminOnly: true,
      },
      {
        href: APP_ROUTES.adminMigration,
        label: "数据迁移",
        description: "打包导出与导入，换服务器搬家",
        icon: ArrowLeftRight,
        superAdminOnly: true,
      },
      {
        href: APP_ROUTES.adminApiTokens,
        label: "访问令牌",
        description: "MCP 等外部客户端的个人访问令牌",
        icon: KeyRound,
      },
    ],
  },
] as const;
