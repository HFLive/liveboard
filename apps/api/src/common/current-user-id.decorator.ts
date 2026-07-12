import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import { verifySessionCookieValue } from "./session-cookie";

export const CurrentUserId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string | null => {
    const request = context.switchToHttp().getRequest<Request>();
    const cookies = request.cookies as
      Record<string, string | undefined> | undefined;
    return verifySessionCookieValue(cookies?.liveboard_session);
  },
);
