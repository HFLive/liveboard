import { BadRequestException } from "@nestjs/common";
import { getResourceNameError, normalizeResourceName } from "@liveboard/shared";

export function requireResourceName(value: string, label: string) {
  const error = getResourceNameError(value, label);
  if (error) {
    throw new BadRequestException(error);
  }
  return normalizeResourceName(value);
}
