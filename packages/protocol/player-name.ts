import type { AccountUser } from './account';

export function playerName(user: AccountUser | null | undefined): string {
  return user?.kind === 'member'
    ? user.email
        ?.split('@')[0]
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .trim()
        .slice(0, 40) || 'プレイヤー'
    : 'ゲスト';
}
