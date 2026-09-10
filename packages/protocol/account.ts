export interface AccountUser {
  id: string;
  kind: 'guest' | 'member';
  email: string | null;
}
export interface PersonalBest {
  ticks: number;
  achievedAt: number;
}
export interface RankingEntry {
  rank: number;
  name: string;
  value: number;
  isYou: boolean;
}
export interface Leaderboard {
  top: RankingEntry[];
  mine: { rank: number; value: number } | null;
}
export interface Rankings {
  sprint: Leaderboard;
  random: Leaderboard;
}
export interface AccountState {
  user: AccountUser;
  best40: PersonalBest | null;
  randomStats: { matches: number; wins: number };
  rating: { current: number; peak: number; matches: number } | null;
  // Only page initialization and authentication include the ranking snapshot.
  rankings?: Rankings;
}
export interface RandomResult {
  userId: string;
  matchId: string;
  seat: number;
  wins: [number, number];
}
