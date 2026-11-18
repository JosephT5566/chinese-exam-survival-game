import { describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import { bank } from '../../src/questions/bank';
import { readConfig } from '../../src/firebase/config';
import { parseRoom, parseScore, parsePlayer, parseAnswer, restoreCursor, LeaderboardBuffer } from '../../src/firebase/model';

const player = () => ({ nickname: '同學', joinedAt: Timestamp.fromMillis(1), finishedAt: null,
  questionOrder: bank.map(q => q.id), choiceOrders: Object.fromEntries(bank.map(q => [q.id, [0,1,2,3]])),
  completedCount: 0, revision: 0, lastOperation: null, cooldownStartedAt: null, pendingId: null });
const room = () => ({ code: 'ABC123', ownerUid: 'teacher', questionSetVersion: 'chinese-grade9-v1', status: 'running',
  rulesVersion: 2, durationMinutes: 20, remainingMs: 1_200_000, runningSince: Timestamp.fromMillis(1000), pausedAt: null, playerCount: 1 });
const answer = () => ({ ordinal: 40, selectedChoice: 2, isCorrect: false, explanationViewed: false,
  awardedPoints: 0, answeredAt: Timestamp.fromMillis(1000), explanationViewedAt: null, chest: null });

describe('cloud boundaries', () => {
  it('rejects incomplete config instead of silently using a demo', () => {
    expect(readConfig({})).toBeNull();
    expect(() => readConfig({ VITE_FIREBASE_PROJECT_ID: 'real' })).toThrow();
    expect(() => readConfig({ VITE_FIREBASE_EMULATORS: 'true', VITE_FIREBASE_PROJECT_ID: 'real' })).toThrow();
    expect(readConfig({ VITE_FIREBASE_EMULATORS: 'true' })?.projectId).toBe('demo-chinese-exam');
  });
  it('rejects unknown questions and invalid choice orders on rehydration', () => {
    expect(parsePlayer('uid', player()).order).toHaveLength(40);
    expect(() => parsePlayer('uid', { ...player(), questionOrder: Array(40).fill('missing') })).toThrow();
    expect(() => parsePlayer('uid', { ...player(), choiceOrders: { ...player().choiceOrders, [bank[0]!.id]: [0,0,1,2] } })).toThrow();
    expect(() => parsePlayer('uid', { ...player(), pendingId: bank[0]!.id })).toThrow();
  });
  it('separates authoritative public score and private progress, derives freeze deadline', () => {
    const score = parseScore('uid', { nickname: '同學', score: 9000, lastOperation: null });
    const p = parsePlayer('uid', { ...player(), completedCount: 40, cooldownStartedAt: Timestamp.fromMillis(1000) }, score);
    expect(p.totalScore).toBe(9000); expect(p.cooldownUntil).toBe(4000); expect(p.finishedAt).toBeNull();
    expect(() => parsePlayer('other', player(), score)).toThrow();
    expect(() => parseScore('uid', { nickname: '同學', score: 96001, lastOperation: null })).toThrow();
    expect(() => parseScore('uid', { nickname: '同學', score: 0, lastOperation: null, answers: [] })).toThrow();
  });
  it('normalizes paused time without advancing countdown and identifies legacy rooms', () => {
    expect(parseRoom('id', room()).runningSince).toBe(1000);
    const paused = parseRoom('id', { ...room(), status: 'paused', pausedAt: Timestamp.fromMillis(6000) });
    expect(paused.remainingMs).toBe(1_195_000); expect(paused.runningSince).toBeNull();
    expect(parseRoom('id', { code: 'ABC123', ownerUid: 'teacher', questionSetVersion: 'chinese-grade9-v1', status: 'ended' }).rulesVersion).toBe(1);
    expect(() => parseRoom('id', { ...room(), rulesVersion: 3 })).toThrow();
  });
  it('keeps the last answer visible after reload with zero fixed points and persisted chest', () => {
    expect(restoreCursor(0)).toBe(0); expect(restoreCursor(1)).toBe(0); expect(restoreCursor(40)).toBe(39);
    expect(parseAnswer(answer())).toMatchObject({ viewed: false, points: 0, answeredAt: 1000, chest: null });
    expect(parseAnswer({ ...answer(), isCorrect: true, chest: { box: 1, outcome: { kind: 'gain', amount: 80 }, targetId: null, settled: true, delta: 80, fallback: false } }).chest?.delta).toBe(80);
    expect(() => parseAnswer({ ...answer(), awardedPoints: 20 })).toThrow();
    expect(() => parseAnswer({ ...answer(), chest: { box: 3 } })).toThrow();
  });
  it('never combines leaderboard pages from different commits and rejects private fields', () => {
    const buffer = new LeaderboardBuffer(), at = Timestamp.fromMillis(1000), next = Timestamp.fromMillis(2000);
    expect(buffer.accept(0, { updatedAt: at, entries: [{ nickname: '甲甲', score: 100 }] })).toBeNull();
    expect(buffer.accept(1, { updatedAt: at, entries: [{ nickname: '乙乙', score: 20 }] })?.entries).toHaveLength(2);
    expect(buffer.accept(0, { updatedAt: next, entries: [] })).toBeNull();
    expect(buffer.accept(1, { updatedAt: next, entries: [] })?.entries).toEqual([]);
    expect(() => buffer.accept(0, { updatedAt: next, entries: [{ nickname: '甲甲', score: 0, uid: 'private' }] })).toThrow();
  });
});
