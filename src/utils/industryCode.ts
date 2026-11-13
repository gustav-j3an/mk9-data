const INDUSTRY_CODE_PATTERN = /^IND-[A-Z0-9]+(?:-[A-Z0-9]+)*$/;

export function normalizeIndustryCode(value: string): string {
  return value.trim().toUpperCase();
}

export function isValidIndustryCode(value: string): boolean {
  return INDUSTRY_CODE_PATTERN.test(normalizeIndustryCode(value));
}
