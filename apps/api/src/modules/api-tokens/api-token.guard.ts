import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { AuthenticatedRequest } from "../../common/active-user.guard";
import { ApiTokenService } from "./api-token.service";

/**
 * PAT 守卫：解析 `Authorization: Bearer <token>`，把令牌对应的用户设为
 * 请求身份。只挂在 MCP controller 上（配合 @Public() 豁免 cookie 守卫），
 * 不扩大到全 API。
 */
@Injectable()
export class ApiTokenGuard implements CanActivate {
  constructor(private readonly apiTokens: ApiTokenService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest & { auth?: unknown }>();
    const header = request.headers.authorization;
    const value = Array.isArray(header) ? header[0] : header;
    const match = value?.match(/^Bearer\s+(\S+)$/i);
    const identity = match ? await this.apiTokens.authenticate(match[1]) : null;
    if (!identity) {
      throw new UnauthorizedException("Invalid or expired API token");
    }

    request.currentUserId = identity.userId;
    // MCP transport 会把 req.auth 作为 authInfo 透传给工具 handler 的 extra。
    request.auth = identity;
    return true;
  }
}
