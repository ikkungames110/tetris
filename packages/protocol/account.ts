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
  randomStats: { matches: number; wins: number };
  rating: { current: number; peak: number; matches: number } | null;
}
export interface RandomResult {
  userId: string;
  matchId: string;
  seat: number;
  wins: [number, number];
}
