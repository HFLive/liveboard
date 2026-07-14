import { Controller, Get } from "@nestjs/common";
import { Public } from "../../common/public.decorator";
import { HealthService } from "./health.service";

@Public()
@Controller("health")
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  check() {
    return this.health.check();
  }
}
