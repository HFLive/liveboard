import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { isSuperAdmin } from "@liveboard/shared";
import { PrismaService } from "../prisma/prisma.service";

export interface UpdateSystemSettingsInput {
  timeZone?: string;
}

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async getPublicSettings() {
    const workspace = await this.getDefaultWorkspace();

    return this.toPublicSettings(workspace);
  }

  async getSettings(userId: string | null) {
    await this.requireAdmin(userId);
    const workspace = await this.getDefaultWorkspace();

    return this.toPublicSettings(workspace);
  }

  async updateSettings(
    userId: string | null,
    input: UpdateSystemSettingsInput,
  ) {
    await this.requireAdmin(userId);
    const workspace = await this.getDefaultWorkspace();
    const data: { timeZone?: string } = {};

    if (input.timeZone !== undefined) {
      data.timeZone = normalizeTimeZone(input.timeZone);
    }

    const updated = await this.prisma.workspace.update({
      where: { id: workspace.id },
      data,
    });

    return this.toPublicSettings(updated);
  }

  private async requireAdmin(userId: string | null) {
    if (!userId) {
      throw new UnauthorizedException("Missing session");
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || !isSuperAdmin(user.systemRole) || user.status !== "active") {
      throw new ForbiddenException(
        "Only super administrators can manage system settings",
      );
    }
  }

  private async getDefaultWorkspace() {
    const workspace = await this.prisma.workspace.findFirst({
      orderBy: { createdAt: "asc" },
    });

    if (!workspace) {
      throw new NotFoundException("Workspace not found");
    }

    return workspace;
  }

  private toPublicSettings(workspace: {
    name: string;
    slug: string;
    timeZone: string;
    updatedAt: Date;
  }) {
    return {
      workspaceName: workspace.name,
      workspaceSlug: workspace.slug,
      timeZone: workspace.timeZone,
      updatedAt: workspace.updatedAt.toISOString(),
    };
  }
}

function normalizeTimeZone(value: string) {
  const timeZone = value.trim();

  if (!timeZone) {
    throw new BadRequestException("时区不能为空");
  }

  try {
    new Intl.DateTimeFormat("zh-CN", { timeZone }).format(new Date());
  } catch {
    throw new BadRequestException("无效的 IANA 时区标识");
  }

  return timeZone;
}
