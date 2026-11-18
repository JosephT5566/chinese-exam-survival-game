import { Timestamp } from 'firebase/firestore';
import { questions, sections } from '../questions/bank';
import type { Answer } from '../game/session';
import type { Chest, ChestOutcome, Timer } from '../game/rewards';

export type RoomStatus = 'lobby' | 'running' | 'paused' | 'ended' | 'archived';
export const questionSetVersion = 'chinese-grade9-v1';
export interface CloudRoom extends Timer {
  id: string; code: string; ownerUid: string; status: RoomStatus; questionSetVersion: string;
  rulesVersion: 1 | 2; playerCount: number;
}
export interface CloudPlayer {
  id: string; nickname: string; joinedAt: number; finishedAt: number | null;
  order: string[]; choices: Record<string, number[]>;
  completedCount: number; totalScore: number; revision: number;
  cooldownUntil: number | null; pendingId: string | null;
}
export interface CloudAnswer extends Answer { ordinal: number; points: number }
export interface PublicScore { id: string; nickname: string; score: number }
export interface RankEntry { nickname: string; score: number }
export interface Leaderboard { entries: RankEntry[]; updatedAt: Timestamp }
export function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function bad(): never { throw new Error('雲端資料格式或題庫版本不符，請聯絡老師。'); }
function integer(value: unknown, max = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max;
}
function millis(value: unknown): number | null {
  if (value === null) return null;
  return value instanceof Timestamp ? value.toMillis() : bad();
}
function elapsedMillis(start: unknown, end: unknown): number {
  if (!(start instanceof Timestamp) || !(end instanceof Timestamp)) return bad();
  return Math.floor((end.seconds - start.seconds) * 1000 + (end.nanoseconds - start.nanoseconds) / 1_000_000);
}
export function parseRoom(id: string, value: unknown): CloudRoom {
  if (!object(value) || typeof value.code !== 'string' || !/^[A-Z0-9]{6}$/.test(value.code)
    || typeof value.ownerUid !== 'string' || value.questionSetVersion !== questionSetVersion) return bad();
  const status = value.status;
  if (status !== 'lobby' && status !== 'running' && status !== 'paused' && status !== 'ended' && status !== 'archived') return bad();
  const base = { id, code: value.code, ownerUid: value.ownerUid, status, questionSetVersion: value.questionSetVersion };
  if (value.rulesVersion === undefined) return { ...base, status, rulesVersion: 1, durationMinutes: 0, remainingMs: 0, runningSince: null, playerCount: 0 };
  if (value.rulesVersion !== 2 || !integer(value.durationMinutes, 60) || value.durationMinutes < 1
    || !integer(value.remainingMs, 3_600_000) || !integer(value.playerCount, 30)) return bad();
  return { ...base, status, rulesVersion: 2, durationMinutes: value.durationMinutes,
    remainingMs: value.status === 'paused' ? Math.max(0, value.remainingMs - elapsedMillis(value.runningSince, value.pausedAt)) : value.remainingMs, runningSince: value.status === 'paused' ? null : millis(value.runningSince), playerCount: value.playerCount };
}
export function parseScore(id: string, value: unknown): PublicScore {
  if (!object(value) || Object.keys(value).length !== 3 || typeof value.nickname !== 'string'
    || !integer(value.score, 96_000) || !('lastOperation' in value)) return bad();
  return { id, nickname: value.nickname, score: value.score };
}
export function parsePlayer(id: string, value: unknown, publicScore?: PublicScore): CloudPlayer {
  if (!object(value) || typeof value.nickname !== 'string' || !(value.joinedAt instanceof Timestamp)
    || !(value.finishedAt === null || value.finishedAt instanceof Timestamp)
    || !integer(value.completedCount, 40) || !integer(value.revision, 120)
    || !Array.isArray(value.questionOrder) || value.questionOrder.length !== 40 || !object(value.choiceOrders)) return bad();
  const legacy = 'score' in value;
  const totalScore = legacy ? value.score : publicScore?.score ?? 0;
  if (!integer(totalScore, 96_000) || (publicScore && (publicScore.id !== id || publicScore.nickname !== value.nickname))) return bad();
  const order: string[] = [], choices: Record<string, number[]> = {};
  for (const id of value.questionOrder) {
    if (typeof id !== 'string' || !questions.has(id) || order.includes(id)) return bad();
    const choice = value.choiceOrders[id];
    if (!Array.isArray(choice) || choice.length !== 4 || !choice.every(c => integer(c, 3)) || new Set(choice).size !== 4) return bad();
    order.push(id); choices[id] = choice;
  }
  if (Object.keys(value.choiceOrders).length !== 40
    || sections.some(s => order.filter(id => questions.get(id)?.sectionId === s).length !== 10)
    || (value.finishedAt !== null && value.completedCount !== 40)) return bad();
  const pendingId = legacy ? null : value.pendingId;
  if (!(pendingId === null || (typeof pendingId === 'string' && order[value.completedCount - 1] === pendingId))) return bad();
  return { id, nickname: value.nickname, joinedAt: value.joinedAt.toMillis(),
    finishedAt: millis(value.finishedAt), order, choices, completedCount: value.completedCount,
    totalScore, revision: value.revision, pendingId, cooldownUntil: legacy || value.cooldownStartedAt === null ? null : (millis(value.cooldownStartedAt) ?? 0) + 3000 };
}
function parseOutcome(value: unknown): ChestOutcome {
  if (!object(value) || Object.keys(value).length !== 2) return bad();
  const { kind, amount } = value;
  if (kind === 'gain' && (amount === 20 || amount === 50 || amount === 80)) return { kind, amount };
  if (kind === 'loss' && (amount === 10 || amount === 20 || amount === 30)) return { kind, amount };
  if ((kind === 'steal' || kind === 'swap') && amount === 0) return { kind, amount };
  return bad();
}
function parseChest(value: unknown): Chest | null {
  if (value === null) return null;
  if (!object(value) || Object.keys(value).length !== 6 || !integer(value.box, 2)
    || !(value.targetId === null || typeof value.targetId === 'string') || typeof value.settled !== 'boolean'
    || typeof value.delta !== 'number' || !Number.isSafeInteger(value.delta) || Math.abs(value.delta) > 96_000
    || typeof value.fallback !== 'boolean') return bad();
  return { box: value.box, outcome: parseOutcome(value.outcome), targetId: value.targetId,
    settled: value.settled, delta: value.delta, fallback: value.fallback };
}
export function parseAnswer(value: unknown): CloudAnswer {
  if (!object(value) || !integer(value.ordinal, 40) || value.ordinal < 1 || !integer(value.selectedChoice, 3)
    || typeof value.isCorrect !== 'boolean' || typeof value.explanationViewed !== 'boolean'
    || !(value.answeredAt instanceof Timestamp)
    || !(value.explanationViewedAt === null || value.explanationViewedAt instanceof Timestamp)) return bad();
  const legacy = !('chest' in value);
  const points = legacy ? value.isCorrect ? 100 : value.explanationViewed ? 20 : 0 : 0;
  if (value.awardedPoints !== points) return bad();
  return { ordinal: value.ordinal, selected: value.selectedChoice, correct: value.isCorrect,
    viewed: value.explanationViewed, points, answeredAt: value.answeredAt.toMillis(), chest: legacy ? null : parseChest(value.chest) };
}
export const restoreCursor = (completedCount: number) => Math.max(0, completedCount - 1);
export function rankedPlayers(players: CloudPlayer[]): RankEntry[] {
  return [...players].sort((a, b) => b.totalScore - a.totalScore
    || (a.finishedAt ?? Infinity) - (b.finishedAt ?? Infinity)
    || a.joinedAt - b.joinedAt || a.id.localeCompare(b.id))
    .slice(0, 30).map(p => ({ nickname: p.nickname, score: p.totalScore }));
}
export class LeaderboardBuffer {
  private pages: [Leaderboard | null, Leaderboard | null] = [null, null];
  accept(page: 0 | 1, value: unknown): Leaderboard | null {
    if (!object(value) || !(value.updatedAt instanceof Timestamp) || !Array.isArray(value.entries)
      || value.entries.length > 15 || Object.keys(value).length !== 2) return bad();
    const entries: RankEntry[] = [];
    for (const entry of value.entries) {
      if (!object(entry) || Object.keys(entry).length !== 2 || typeof entry.nickname !== 'string' || !integer(entry.score)) return bad();
      entries.push({ nickname: entry.nickname, score: entry.score });
    }
    this.pages[page] = { updatedAt: value.updatedAt, entries };
    const [first, second] = this.pages;
    if (!first || !second || !first.updatedAt.isEqual(second.updatedAt)) return null;
    return { updatedAt: first.updatedAt, entries: [...first.entries, ...second.entries] };
  }
}
