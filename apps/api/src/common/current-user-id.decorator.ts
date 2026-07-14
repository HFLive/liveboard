import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { AuthenticatedRequest } from "./active-user.guard";

export const CurrentUserId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string | null => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    return request.currentUserId ?? null;
  },
);
