export interface AccountUser {
  id: string;
  kind: 'guest' | 'member';
  email: string | null;
}
export interface PersonalBest {
  ticks: number;
  achievedAt: number;
}
export interface AccountState {
  user: AccountUser;
  best40: PersonalBest | null;
}
