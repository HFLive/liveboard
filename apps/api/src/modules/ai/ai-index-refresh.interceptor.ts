import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from "@nestjs/common";
import { tap } from "rxjs";
import { AiRagService } from "./ai-rag.service";

@Injectable()
export class AiIndexRefreshInterceptor implements NestInterceptor {
  constructor(private readonly rag: AiRagService) {}

  intercept(context: ExecutionContext, next: CallHandler) {
    const method = context
      .switchToHttp()
      .getRequest<{ method: string }>().method;
    return next.handle().pipe(
      tap(() => {
        if (["POST", "PATCH", "PUT", "DELETE"].includes(method))
          this.rag.scheduleSync();
      }),
    );
  }
}
