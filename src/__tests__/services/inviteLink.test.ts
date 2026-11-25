import {
  buildInviteUrl,
  INVITE_CODE_RE,
  joinNoticeText,
  parseInviteUrl,
} from '../../services/invites/inviteLink';

describe('inviteLink', () => {
  it('INV-1 builds and parses a round trip', () => {
    expect(buildInviteUrl('ABCDEFGHJK')).toBe('pitchiq://join/ABCDEFGHJK');
    expect(parseInviteUrl(buildInviteUrl('ABCDEFGHJK'))).toBe('ABCDEFGHJK');
  });

  it('INV-1 is case-insensitive, trims, and ignores query/hash/trailing slash', () => {
    expect(parseInviteUrl('  PitchIQ://JOIN/abcdefghjk?utm=1#x ')).toBe('ABCDEFGHJK');
    expect(parseInviteUrl('pitchiq://join/ABCDEFGHJK/')).toBe('ABCDEFGHJK');
  });

  it.each([
    'https://pitchiq.app/join/ABCDEFGHJK',
    'http://join/ABCDEFGHJK',
    'pitchiq://group/ABCDEFGHJK',
    'pitchiq://join/ABCDEFGHJ',
    'pitchiq://join/ABCDEFGHJK1',
    'pitchiq://join/ABCDEFGHJ0',
    'pitchiq://join/ABCDEFGHIO',
    'pitchiq://join/',
    'pitchiq://join/ABCDEFGHJK/extra',
    'pitchiq://evil.com/join/ABCDEFGHJK',
    '',
  ])('INV-1 rejects %j', (url) => {
    expect(parseInviteUrl(url)).toBeNull();
  });

  it('INV-1 rejects non-string input', () => {
    expect(parseInviteUrl(undefined as unknown as string)).toBeNull();
  });

  it('code alphabet matches the server', () => {
    expect(INVITE_CODE_RE.test('ABCDEFGHJK')).toBe(true);
    expect(INVITE_CODE_RE.test('abcdefghjk')).toBe(false);
  });

  it('INV-3 notice texts', () => {
    expect(joinNoticeText('parental_consent_required')).toBe(
      'A parent needs to verify your account before you can join a squad.',
    );
    for (const r of ['joined', 'invite_invalid', 'profile_required', 'not_authenticated', 'offline'] as const) {
      expect(joinNoticeText(r).length).toBeGreaterThan(5);
    }
  });
});
