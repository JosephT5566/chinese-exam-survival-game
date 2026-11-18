import { Timestamp } from 'firebase/firestore';
import { questions, sections } from '../questions/bank';
import type { Answer } from '../game/session';

export type RoomStatus = 'lobby' | 'running' | 'paused' | 'ended' | 'archived';
export const questionSetVersion = 'chinese-grade9-v1';
export interface CloudRoom { id: string; code: string; ownerUid: string; status: RoomStatus; questionSetVersion: string }
export interface CloudPlayer {
  id: string; nickname: string; joinedAt: number; finishedAt: number | null;
  order: string[]; choices: Record<string, number[]>;
  completedCount: number; totalScore: number; revision: number;
}
export interface CloudAnswer extends Answer { ordinal: number; points: number }
export interface RankEntry { nickname: string; score: number }
export interface Leaderboard { entries: RankEntry[]; updatedAt: Timestamp }
export function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function bad(): never { throw new Error('雲端資料格式或題庫版本不符，請聯絡老師。'); }
function integer(value: unknown, max = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max;
}
export function parseRoom(id: string, value: unknown): CloudRoom {
  if (!object(value) || typeof value.code !== 'string' || !/^[A-Z0-9]{6}$/.test(value.code)
    || typeof value.ownerUid !== 'string' || value.questionSetVersion !== questionSetVersion) return bad();
  const status = value.status;
  if (status !== 'lobby' && status !== 'running' && status !== 'paused' && status !== 'ended' && status !== 'archived') return bad();
  return { id, code: value.code, ownerUid: value.ownerUid, status, questionSetVersion: value.questionSetVersion };
}
export function parsePlayer(id: string, value: unknown): CloudPlayer {
  if (!object(value) || typeof value.nickname !== 'string' || !(value.joinedAt instanceof Timestamp)
    || !(value.finishedAt === null || value.finishedAt instanceof Timestamp)
    || !integer(value.completedCount, 40) || !integer(value.score, 5040) || !integer(value.revision, 93)
    || !Array.isArray(value.questionOrder) || value.questionOrder.length !== 40
    || !object(value.choiceOrders)) return bad();
  const order: string[] = [];
  const choices: Record<string, number[]> = {};
  for (const id of value.questionOrder) {
    if (typeof id !== 'string' || !questions.has(id) || order.includes(id)) return bad();
    const choice = value.choiceOrders[id];
    if (!Array.isArray(choice) || choice.length !== 4 || !choice.every(c => integer(c, 3)) || new Set(choice).size !== 4) return bad();
    order.push(id); choices[id] = choice;
  }
  if (Object.keys(value.choiceOrders).length !== 40
    || sections.some(s => order.filter(id => questions.get(id)?.sectionId === s).length !== 10)
    || (value.completedCount === 40) !== (value.finishedAt !== null)) return bad();
  return { id, nickname: value.nickname, joinedAt: value.joinedAt.toMillis(),
    finishedAt: value.finishedAt?.toMillis() ?? null, order, choices,
    completedCount: value.completedCount, totalScore: value.score, revision: value.revision };
}
export function parseAnswer(value: unknown): CloudAnswer {
  if (!object(value) || !integer(value.ordinal, 40) || value.ordinal < 1 || !integer(value.selectedChoice, 3)
    || typeof value.isCorrect !== 'boolean' || typeof value.explanationViewed !== 'boolean'
    || !(value.answeredAt instanceof Timestamp)
    || !(value.explanationViewedAt === null || value.explanationViewedAt instanceof Timestamp)) return bad();
  const points = value.isCorrect ? 100 : value.explanationViewed ? 20 : 0;
  if (value.awardedPoints !== points) return bad();
  return { ordinal: value.ordinal, selected: value.selectedChoice, correct: value.isCorrect,
    viewed: value.explanationViewed, points };
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
