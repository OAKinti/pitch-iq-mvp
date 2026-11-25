/** Squad invite links (D-9B). Pure helpers: the app scheme, the `join` path and a server-format code only. */
export const INVITE_CODE_RE = /^[A-HJ-NP-Z2-9]{10}$/;

const URL_RE = /^pitchiq:\/\/join\/([^/?#\s]+)\/?(?:[?#].*)?$/i;

export function buildInviteUrl(code: string): string {
  return `pitchiq://join/${code}`;
}

export type JoinNoticeReason =
  | 'joined'
  | 'invite_invalid'
  | 'parental_consent_required'
  | 'profile_required'
  | 'not_authenticated'
  | 'offline';

/** User-facing text for the join result notice (INV-3). */
export function joinNoticeText(reason: JoinNoticeReason): string {
  switch (reason) {
    case 'joined':
      return 'You joined the squad.';
    case 'parental_consent_required':
      return 'A parent needs to verify your account before you can join a squad.';
    case 'invite_invalid':
      return 'This invite link is invalid, expired or full. Ask your friend for a new one.';
    case 'profile_required':
      return 'Finish setting up your profile, then open the invite link again.';
    case 'not_authenticated':
    case 'offline':
      return 'Could not reach the server. Check your connection and open the invite link again.';
  }
}

/** Returns the normalised (upper-case) code, or null for anything that is not a valid app join link. */
export function parseInviteUrl(url: string): string | null {
  if (typeof url !== 'string') return null;
  const match = URL_RE.exec(url.trim());
  if (!match) return null;
  const code = (match[1] as string).toUpperCase();
  return INVITE_CODE_RE.test(code) ? code : null;
}
