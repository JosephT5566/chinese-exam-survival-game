import { describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import { bank } from '../../src/questions/bank';
import { readConfig } from '../../src/firebase/config';
import { parsePlayer, parseAnswer, restoreCursor, LeaderboardBuffer } from '../../src/firebase/model';

const player = () => ({ nickname: '同學', joinedAt: Timestamp.fromMillis(1), finishedAt: null,
  questionOrder: bank.map(q => q.id), choiceOrders: Object.fromEntries(bank.map(q => [q.id, [0,1,2,3]])),
  completedCount: 0, score: 0, eventCount: 0, revision: 0, lastOperation: null });

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
  });
  it('keeps the last answer visible after reload, including the final explanation', () => {
    expect(restoreCursor(0)).toBe(0);
    expect(restoreCursor(1)).toBe(0);
    expect(restoreCursor(40)).toBe(39);
    expect(parseAnswer({ ordinal: 40, selectedChoice: 2, isCorrect: false, explanationViewed: false,
      awardedPoints: 0, answeredAt: Timestamp.now(), explanationViewedAt: null }).viewed).toBe(false);
  });
  it('never combines leaderboard pages from different commits and rejects private fields', () => {
    const buffer = new LeaderboardBuffer();
    const at = Timestamp.fromMillis(1000), next = Timestamp.fromMillis(2000);
    expect(buffer.accept(0, { updatedAt: at, entries: [{ nickname: '甲甲', score: 100 }] })).toBeNull();
    expect(buffer.accept(1, { updatedAt: at, entries: [{ nickname: '乙乙', score: 20 }] })?.entries).toHaveLength(2);
    expect(buffer.accept(0, { updatedAt: next, entries: [] })).toBeNull();
    expect(buffer.accept(1, { updatedAt: next, entries: [] })?.entries).toEqual([]);
    expect(() => buffer.accept(0, { updatedAt: next, entries: [{ nickname: '甲甲', score: 0, uid: 'private' }] })).toThrow();
  });
});
