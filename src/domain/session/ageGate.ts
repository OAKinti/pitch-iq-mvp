import type { AgeBracket, ProfileVisibility } from '../../types/contracts';

const MAX_AGE_YEARS = 120;

/**
 * Neutral age gate. Conservative month math: a birthday later this month (or this very month)
 * counts as not yet reached. Invalid, future, or implausible input gives null.
 */
export function classifyAge(birthYear: number, birthMonth: number, now: Date): AgeBracket | null {
  if (!Number.isInteger(birthYear) || !Number.isInteger(birthMonth)) return null;
  if (birthMonth < 1 || birthMonth > 12) return null;
  const nowYear = now.getFullYear();
  const nowMonth = now.getMonth() + 1;
  if (birthYear > nowYear || (birthYear === nowYear && birthMonth > nowMonth)) return null;
  const age = nowYear - birthYear - (nowMonth <= birthMonth ? 1 : 0);
  if (age > MAX_AGE_YEARS) return null;
  if (age < 13) return 'under_13';
  if (age < 18) return 'teen_13_17';
  return 'adult_18_plus';
}

const VISIBILITY: Record<AgeBracket, ProfileVisibility> = {
  under_13: 'private',
  teen_13_17: 'friends',
  adult_18_plus: 'friends',
};

export function defaultVisibility(bracket: AgeBracket): ProfileVisibility {
  return VISIBILITY[bracket];
}

export function requiresParentalConsent(bracket: AgeBracket): boolean {
  return bracket === 'under_13';
}
