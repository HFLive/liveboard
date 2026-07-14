import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { PrismaService } from "../modules/prisma/prisma.service";
import { IS_PUBLIC_KEY } from "./public.decorator";
import { verifySessionCookieValue } from "./session-cookie";

export interface AuthenticatedRequest extends Request {
  currentUserId?: string;
}

@Injectable()
export class ActiveUserGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const cookies = request.cookies as
      Record<string, string | undefined> | undefined;
    const session = verifySessionCookieValue(cookies?.liveboard_session);
    if (!session) {
      throw new UnauthorizedException("Missing or invalid session");
    }

    const user = await this.prisma.user.findUnique({
      where: { id: session.userId },
      select: { id: true, status: true, sessionVersion: true },
    });
    if (
      !user ||
      user.status !== "active" ||
      user.sessionVersion !== session.sessionVersion
    ) {
      throw new UnauthorizedException("Session is no longer valid");
    }

    request.currentUserId = user.id;
    return true;
  }
}
