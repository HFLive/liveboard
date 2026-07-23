export const MAX_RESOURCE_NAME_LENGTH = 120;

const INVALID_RESOURCE_NAME_CHARACTERS =
  /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff\ufffd]/u;

export function normalizeResourceName(value: string) {
  return value
    .normalize("NFC")
    .replace(/[ \t\u3000]+/g, " ")
    .trim();
}

export function getResourceNameError(
  value: string,
  label = "名称",
): string | null {
  const normalized = normalizeResourceName(value);

  if (!normalized) {
    return `${label}不能为空`;
  }

  if (normalized.length > MAX_RESOURCE_NAME_LENGTH) {
    return `${label}不能超过 ${MAX_RESOURCE_NAME_LENGTH} 个字符`;
  }

  if (INVALID_RESOURCE_NAME_CHARACTERS.test(normalized)) {
    return `${label}不能包含换行、控制字符或不可见字符`;
  }

  if (normalized === "." || normalized === "..") {
    return `${label}无效`;
  }

  return null;
}

export function validateResourceName(value: string, label = "名称") {
  const error = getResourceNameError(value, label);
  if (error) {
    throw new Error(error);
  }
  return normalizeResourceName(value);
}
