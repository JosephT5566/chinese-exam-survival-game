import { readFileSync, writeFileSync } from 'node:fs';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import type { RulesTestContext, RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
  collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, setDoc,
  Timestamp, updateDoc, where, writeBatch,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

let env: RulesTestEnvironment;
type Firestore = ReturnType<RulesTestContext['firestore']>;
const past = Timestamp.fromMillis(1_700_000_000_000);
const order = Array.from({ length: 40 }, (_, i) => `q${i + 1}`);
const choices = Object.fromEntries(order.map((id) => [id, [0, 1, 2, 3]]));

function room(ownerUid = 't1', status = 'running', code = 'ABC123') {
  return { ownerUid, status, code, questionSetVersion: 'provisional-v1', createdAt: past,
    updatedAt: past, startedAt: status === 'lobby' ? null : past, endedAt: null };
}
function player() {
  return { nickname: '小明', joinedAt: past, questionOrder: order, choiceOrders: choices,
    completedCount: 0, score: 0, eventCount: 0, revision: 0, lastOperation: null, finishedAt: null };
}
function student(uid = 's1') {
  return env.authenticatedContext(uid, { firebase: { sign_in_provider: 'anonymous' } }).firestore();
}
function teacher(uid = 't1') {
  return env.authenticatedContext(uid, { firebase: { sign_in_provider: 'google.com' } }).firestore();
}
function playerRef(db: Firestore, uid = 's1') { return doc(db, `rooms/r1/players/${uid}`); }
function answerRef(db: Firestore, id = 'q1', uid = 's1') {
  return doc(db, `rooms/r1/players/${uid}/answers/${id}`);
}
async function seed(path: string, data: Record<string, unknown>) {
  await env.withSecurityRulesDisabled(async (context) => { await setDoc(doc(context.firestore(), path), data); });
}
function answerBatch(db: Firestore, options: {
  id?: string; ordinal?: number; correct?: boolean; score?: number; revision?: number; uid?: string;
} = {}) {
  const { id = 'q1', ordinal = 1, correct = true, score = correct ? 100 : 0, revision = 1, uid = 's1' } = options;
  const batch = writeBatch(db);
  batch.set(answerRef(db, id, uid), { ordinal, selectedChoice: 0, isCorrect: correct,
    explanationViewed: false, awardedPoints: correct ? 100 : 0,
    answeredAt: serverTimestamp(), explanationViewedAt: null });
  batch.update(playerRef(db, uid), { completedCount: ordinal, score, revision,
    lastOperation: { kind: 'answer', id }, finishedAt: ordinal === 40 ? serverTimestamp() : null });
  return batch;
}
function explanationBatch(db: Firestore, score = 20, revision = 2) {
  const batch = writeBatch(db);
  batch.update(answerRef(db), { explanationViewed: true, explanationViewedAt: serverTimestamp(), awardedPoints: 20 });
  batch.update(playerRef(db), { score, revision, lastOperation: { kind: 'explanation', id: 'q1' } });
  return batch;
}
function eventBatch(db: Firestore, delta = 80, score = 80, index = 1, revision = 4) {
  const batch = writeBatch(db);
  batch.set(doc(db, `rooms/r1/players/s1/events/${index}`), {
    eventIndex: index, awardedPoints: delta, createdAt: serverTimestamp(),
  });
  batch.update(playerRef(db), { score, eventCount: index, revision,
    lastOperation: { kind: 'event', id: String(index) } });
  return batch;
}

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-chinese-exam', firestore: {
    host: '127.0.0.1', port: 8080, rules: readFileSync('firestore.rules', 'utf8'),
  } });
});
afterAll(async () => {
  try {
    const path = process.env.RULES_COVERAGE_PATH;
    if (path) {
      const response = await fetch('http://127.0.0.1:8080/emulator/v1/projects/demo-chinese-exam:ruleCoverage');
      if (!response.ok) throw new Error(`Coverage HTTP ${response.status}`);
      writeFileSync(path, await response.text());
    }
  } finally {
    await env?.cleanup();
  }
});
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const batch = writeBatch(db);
    batch.set(doc(db, 'teachers/t1'), { authorized: true });
    batch.set(doc(db, 'teachers/t2'), { authorized: true });
    batch.set(doc(db, 'rooms/r1'), room());
    batch.set(doc(db, 'rooms/r2'), room('t2', 'running', 'DEF456'));
    batch.set(doc(db, 'roomCodes/ABC123'), { roomId: 'r1', ownerUid: 't1' });
    batch.set(doc(db, 'rooms/r1/players/s1'), player());
    batch.set(doc(db, 'rooms/r1/players/s2'), { ...player(), nickname: '小華' });
    await batch.commit();
  });
});

describe('身分與私人資料', () => {
  it('Google + allowlist 的老師可讀自己的授權與房間', async () => {
    await assertSucceeds(getDoc(doc(teacher(), 'teachers/t1')));
    await assertSucceeds(getDoc(doc(teacher(), 'rooms/r1')));
  });
  it('未核准 Google、匿名冒用老師 UID 都不能管理房間', async () => {
    await assertFails(getDoc(doc(teacher('outsider'), 'rooms/r1')));
    await assertFails(getDoc(doc(student('t1'), 'rooms/r1')));
  });
  it('客戶端不能自授權、修改或刪除 allowlist', async () => {
    await assertFails(setDoc(doc(teacher('outsider'), 'teachers/outsider'), { authorized: true }));
    await assertFails(updateDoc(doc(teacher(), 'teachers/t1'), { authorized: false }));
    await assertFails(deleteDoc(doc(teacher(), 'teachers/t1')));
  });
  it('撤銷 allowlist 後，Google 老師立即失去房間權限', async () => {
    await seed('teachers/t1', { authorized: false });
    await assertFails(getDoc(doc(teacher(), 'rooms/r1')));
  });
  it('學生可讀本人，不能讀別人；老師可讀自己全班玩家', async () => {
    await assertSucceeds(getDoc(playerRef(student())));
    await assertFails(getDoc(playerRef(student(), 's2')));
    await assertSucceeds(getDocs(collection(teacher(), 'rooms/r1/players')));
    await assertFails(getDocs(collection(student(), 'rooms/r1/players')));
    await assertFails(getDocs(collection(teacher('t2'), 'rooms/r1/players')));
  });
  it('已加入者可恢復讀房間，未加入者與未登入者不能讀', async () => {
    await assertSucceeds(getDoc(doc(student(), 'rooms/r1')));
    await assertFails(getDoc(doc(student('new'), 'rooms/r1')));
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'rooms/r1')));
  });
  it('房間查詢限擁有者條件，不能列舉全站或他人授權資料', async () => {
    await assertSucceeds(getDocs(query(collection(teacher(), 'rooms'), where('ownerUid', '==', 't1'))));
    await assertFails(getDocs(collection(teacher(), 'rooms')));
    await assertFails(getDocs(collection(teacher(), 'teachers')));
  });
  it('加入碼只可登入後精確查詢，不能列舉', async () => {
    await assertSucceeds(getDoc(doc(student('new'), 'roomCodes/ABC123')));
    await assertFails(getDocs(collection(student(), 'roomCodes')));
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'roomCodes/ABC123')));
  });
  it('未知路徑及所有客戶端資料刪除仍拒絕', async () => {
    await assertFails(setDoc(doc(teacher(), 'anything/x'), { value: 1 }));
    for (const path of ['rooms/r1', 'roomCodes/ABC123', 'rooms/r1/players/s1']) {
      await assertFails(deleteDoc(doc(teacher(), path)));
    }
  });
});

describe('房間與加入', () => {
  function createRoom(db: Firestore, code = 'NEW123', ownerUid = 't1') {
    const batch = writeBatch(db);
    batch.set(doc(db, 'rooms/new'), { ...room(ownerUid, 'lobby', code), createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    batch.set(doc(db, `roomCodes/${code}`), { ownerUid, roomId: 'new' });
    return batch;
  }
  it('老師以 batch 同時建立 lobby 與加入碼', async () => { await assertSucceeds(createRoom(teacher()).commit()); });
  it('拒絕單獨建房、非老師建立、偽造 owner 與無效加入碼', async () => {
    await assertFails(setDoc(doc(teacher(), 'rooms/new'), { ...room('t1', 'lobby', 'NEW123'), createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
    await assertFails(createRoom(student()).commit());
    await assertFails(createRoom(teacher(), 'NEW123', 't2').commit());
    await assertFails(createRoom(teacher(), 'bad').commit());
  });
  it('不能覆寫既有加入碼或把索引改指向他人房間', async () => {
    await assertFails(createRoom(teacher(), 'ABC123').commit());
    await assertFails(updateDoc(doc(teacher(), 'roomCodes/ABC123'), { roomId: 'r2' }));
  });
  it('老師可開始、暫停、恢復、結束、封存，不能重開或換 owner', async () => {
    await seed('rooms/r1', room('t1', 'lobby'));
    const reference = doc(teacher(), 'rooms/r1');
    await assertSucceeds(updateDoc(reference, { status: 'running', startedAt: serverTimestamp(), updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(reference, { status: 'paused', updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(reference, { status: 'running', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(reference, { ownerUid: 't2', updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(reference, { status: 'ended', endedAt: serverTimestamp(), updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(reference, { status: 'archived', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(reference, { status: 'running', updatedAt: serverTimestamp() }));
  });
  it('學生、其他老師不能改房間，且不允許跳過開始時間', async () => {
    for (const db of [student(), teacher('t2')]) {
      await assertFails(updateDoc(doc(db, 'rooms/r1'), { status: 'paused', updatedAt: serverTimestamp() }));
    }
    await seed('rooms/r1', room('t1', 'lobby'));
    await assertFails(updateDoc(doc(teacher(), 'rooms/r1'), { status: 'running', updatedAt: serverTimestamp() }));
  });
  it('新匿名學生只在 lobby 以零分與固定排列加入', async () => {
    await seed('rooms/r1', room('t1', 'lobby'));
    await assertSucceeds(setDoc(playerRef(student('new'), 'new'), { ...player(), joinedAt: serverTimestamp() }));
    await assertFails(setDoc(playerRef(student('new'), 'new'), { ...player(), joinedAt: serverTimestamp() }));
    await assertFails(setDoc(playerRef(teacher('new'), 'new'), { ...player(), joinedAt: serverTimestamp() }));
  });
  for (const status of ['running', 'paused', 'ended', 'archived']) {
    it(`${status} 不接受新學生`, async () => {
      await seed('rooms/r1', room('t1', status));
      await assertFails(setDoc(playerRef(student('new'), 'new'), { ...player(), joinedAt: serverTimestamp() }));
    });
  }
  it('拒絕不合長度暱稱、初始加分、重複題序、缺少加入索引及額外 role', async () => {
    await seed('rooms/r1', room('t1', 'lobby'));
    const reference = playerRef(student('new'), 'new');
    for (const patch of [{ nickname: '一' }, { nickname: '字'.repeat(13) }, { score: 100 },
      { questionOrder: Array(40).fill('q1') }, { role: 'teacher' }]) {
      await assertFails(setDoc(reference, { ...player(), ...patch, joinedAt: serverTimestamp() }));
    }
    await seed('roomCodes/ABC123', { roomId: 'r2', ownerUid: 't2' });
    await assertFails(setDoc(reference, { ...player(), joinedAt: serverTimestamp() }));
  });
});

describe('答案與詳解原子計分', () => {
  it('正確作答只加 100，答案與 player 一起持久化', async () => {
    const db = student();
    await assertSucceeds(answerBatch(db).commit());
    const result = await getDoc(playerRef(db));
    expect(result.data()?.score).toBe(100);
    expect(result.data()?.completedCount).toBe(1);
    await assertFails(answerBatch(db).commit());
  });
  it('兩個並發提交同一題只成功一次，不會累加兩次分數', async () => {
    const db = student();
    const results = await Promise.allSettled([answerBatch(db).commit(), answerBatch(db).commit()]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await getDoc(playerRef(db))).data()?.score).toBe(100);
    expect((await getDocs(collection(db, 'rooms/r1/players/s1/answers'))).size).toBe(1);
  });
  it('錯誤提交先 0 分，看詳解才 +20，不能重領', async () => {
    const db = student();
    await assertSucceeds(answerBatch(db, { correct: false }).commit());
    expect((await getDoc(playerRef(db))).data()?.score).toBe(0);
    await assertSucceeds(explanationBatch(db).commit());
    expect((await getDoc(playerRef(db))).data()?.score).toBe(20);
    await assertFails(explanationBatch(db, 40, 3).commit());
  });
  it('正確題不可額外領詳解分，錯題也不能提前領', async () => {
    await assertSucceeds(answerBatch(student()).commit());
    await assertFails(explanationBatch(student(), 120).commit());
    await seed('rooms/r1/players/s1', player());
    await assertFails(answerBatch(student(), { correct: false, score: 20 }).commit());
  });
  it('單改分、跳題、改洗牌、負分、越界選項與不完整原子操作都拒絕', async () => {
    const db = student();
    await assertFails(updateDoc(playerRef(db), { score: 100 }));
    await assertFails(answerBatch(db, { id: 'q2', ordinal: 2 }).commit());
    await assertFails(answerBatch(db, { score: -1 }).commit());
    const bad = answerBatch(db);
    bad.update(playerRef(db), { questionOrder: [...order].reverse() });
    await assertFails(bad.commit());
    const badChoice = answerBatch(db);
    badChoice.update(answerRef(db), { selectedChoice: 4 });
    await assertFails(badChoice.commit());
    await assertFails(setDoc(answerRef(db), { ordinal: 1, selectedChoice: 0, isCorrect: true,
      explanationViewed: false, awardedPoints: 100, answeredAt: serverTimestamp(), explanationViewedAt: null }));
    await assertFails(updateDoc(playerRef(db), { score: 100, completedCount: 1, revision: 1,
      lastOperation: { kind: 'answer', id: 'q1' } }));
  });
  it('不能一次塞兩題只更新一次玩家', async () => {
    const db = student();
    const batch = answerBatch(db);
    batch.set(answerRef(db, 'q2'), { ordinal: 2, selectedChoice: 0, isCorrect: true,
      explanationViewed: false, awardedPoints: 100, answeredAt: serverTimestamp(), explanationViewedAt: null });
    await assertFails(batch.commit());
  });
  it('題目排列必須是完整四選項，不能提交其他題目', async () => {
    await seed('rooms/r1/players/s1', { ...player(), choiceOrders: { ...choices, q1: [0, 0, 1, 2] } });
    await assertFails(answerBatch(student()).commit());
    await seed('rooms/r1/players/s1', player());
    await assertFails(answerBatch(student(), { id: 'unknown' }).commit());
  });
  for (const status of ['lobby', 'paused', 'ended', 'archived']) {
    it(`${status} 禁止新作答及錯題領分，但仍可讀既有答案`, async () => {
      const db = student();
      await assertSucceeds(answerBatch(db, { correct: false }).commit());
      await seed('rooms/r1', room('t1', status));
      await assertFails(answerBatch(db, { id: 'q2', ordinal: 2, score: 100, revision: 2 }).commit());
      await assertFails(explanationBatch(db).commit());
      await assertSucceeds(getDoc(answerRef(db)));
    });
  }
  it('老師能看自己房間答案，不能修改；學生不能跨人讀寫', async () => {
    await assertSucceeds(answerBatch(student()).commit());
    await assertSucceeds(getDoc(answerRef(teacher())));
    await assertFails(getDoc(answerRef(student('s2'))));
    await assertFails(getDoc(answerRef(teacher('t2'))));
    await assertFails(updateDoc(answerRef(teacher()), { selectedChoice: 1 }));
    await assertFails(answerBatch(student('s2'), { uid: 's1', id: 'q2', ordinal: 2, score: 200, revision: 2 }).commit());
    await assertFails(updateDoc(answerRef(student()), { isCorrect: false }));
    await assertFails(deleteDoc(answerRef(student())));
  });
  it('第 40 題設定完成時間，之後仍可領最後錯題詳解，不能提交第 41 題', async () => {
    await seed('rooms/r1/players/s1', { ...player(), completedCount: 39, eventCount: 13, revision: 52 });
    const db = student();
    await assertSucceeds(answerBatch(db, { id: 'q40', ordinal: 40, correct: false, revision: 53 }).commit());
    expect((await getDoc(playerRef(db))).data()?.finishedAt).toBeInstanceOf(Timestamp);
    await assertFails(answerBatch(db, { id: 'q41', ordinal: 41, revision: 54 }).commit());
    const batch = writeBatch(db);
    batch.update(answerRef(db, 'q40'), { explanationViewed: true, explanationViewedAt: serverTimestamp(), awardedPoints: 20 });
    batch.update(playerRef(db), { score: 20, revision: 54, lastOperation: { kind: 'explanation', id: 'q40' } });
    await assertSucceeds(batch.commit());
  });
  it('完整 40 題與 13 次事件可持續提交，最終分數恰為 5040', async () => {
    const db = student();
    let revision = 0;
    let total = 0;
    for (let ordinal = 1; ordinal <= 40; ordinal++) {
      total += 100;
      await assertSucceeds(answerBatch(db, { id: `q${ordinal}`, ordinal, score: total, revision: ++revision }).commit());
      if (ordinal % 3 === 0) {
        total += 80;
        await assertSucceeds(eventBatch(db, 80, total, ordinal / 3, ++revision).commit());
      }
    }
    const final = (await getDoc(playerRef(db))).data();
    expect(final?.score).toBe(5040);
    expect(final?.completedCount).toBe(40);
    expect(final?.eventCount).toBe(13);
    expect(final?.revision).toBe(53);
  });
});

describe('命運事件', () => {
  beforeEach(async () => { await seed('rooms/r1/players/s1', { ...player(), completedCount: 3, revision: 3 }); });
  it('第三題後事件可 +80，不能重領、修改或刪除', async () => {
    const db = student();
    await assertSucceeds(eventBatch(db).commit());
    expect((await getDoc(playerRef(db))).data()?.score).toBe(80);
    await assertFails(eventBatch(db, 80, 160, 1, 5).commit());
    await assertFails(updateDoc(doc(db, 'rooms/r1/players/s1/events/1'), { awardedPoints: 0 }));
    await assertFails(deleteDoc(doc(db, 'rooms/r1/players/s1/events/1')));
  });
  it('負事件歸零，不能存負分或故意不扣分', async () => {
    await seed('rooms/r1/players/s1', { ...player(), score: 20, completedCount: 3, revision: 3 });
    await assertFails(eventBatch(student(), -30, -10).commit());
    await assertFails(eventBatch(student(), -30, 20).commit());
    await assertSucceeds(eventBatch(student(), -30, 0).commit());
  });
  it('拒絕超界、小數、提前、跳號及第 14 次事件', async () => {
    for (const delta of [-31, 81, 1.5]) await assertFails(eventBatch(student(), delta, Math.max(0, delta)).commit());
    await assertFails(eventBatch(student(), 80, 80, 2).commit());
    await seed('rooms/r1/players/s1', { ...player(), completedCount: 2, revision: 2 });
    await assertFails(eventBatch(student(), 80, 80, 1, 3).commit());
    await seed('rooms/r1/players/s1', { ...player(), completedCount: 40, eventCount: 13, revision: 53, finishedAt: past });
    await assertFails(eventBatch(student(), 80, 80, 14, 54).commit());
  });
  it('事件紀錄與玩家更新不可分開寫', async () => {
    await assertFails(setDoc(doc(student(), 'rooms/r1/players/s1/events/1'), { eventIndex: 1, awardedPoints: 80, createdAt: serverTimestamp() }));
    await assertFails(updateDoc(playerRef(student()), { eventCount: 1, score: 80, revision: 4, lastOperation: { kind: 'event', id: '1' } }));
  });
  it('暫停不能領事件', async () => {
    await seed('rooms/r1', room('t1', 'paused'));
    await assertFails(eventBatch(student()).commit());
  });
});

describe('全班排名快照', () => {
  const entries = Array.from({ length: 30 }, (_, i) => ({ nickname: `同學${i + 1}`, score: 100 }));
  function snapshot(db: Firestore, list: unknown[] = entries) {
    const batch = writeBatch(db);
    batch.set(doc(db, 'rooms/r1/public/leaderboard'), { entries: list.slice(0, 15), updatedAt: serverTimestamp() });
    batch.set(doc(db, 'rooms/r1/public/leaderboard2'), { entries: list.slice(15), updatedAt: serverTimestamp() });
    return batch.commit();
  }
  it('老師可發布完整 30 人排名，會員可讀，非會員與其他老師不可讀', async () => {
    await assertSucceeds(snapshot(teacher()));
    await assertSucceeds(getDoc(doc(student(), 'rooms/r1/public/leaderboard')));
    await assertSucceeds(getDoc(doc(student(), 'rooms/r1/public/leaderboard2')));
    await assertFails(getDoc(doc(student('new'), 'rooms/r1/public/leaderboard')));
    await assertFails(getDoc(doc(teacher('t2'), 'rooms/r1/public/leaderboard')));
  });
  it('學生、其他老師不能寫；31 人、無效分數、第一與最後一筆洩露 UID 都拒絕', async () => {
    await assertFails(snapshot(student()));
    await assertFails(snapshot(teacher('t2')));
    await assertFails(snapshot(teacher(), [...entries, { nickname: '額外同學', score: 0 }]));
    await assertFails(snapshot(teacher(), [{ nickname: '小明', score: -1 }]));
    for (const index of [0, 29]) {
      await assertFails(snapshot(teacher(), entries.map((entry, i) => i === index ? { ...entry, uid: 'secret' } : entry)));
    }
  });
  it('老師可發布空快照，但不能混入額外欄位或偽造時間', async () => {
    await assertSucceeds(snapshot(teacher(), []));
    const reference = doc(teacher(), 'rooms/r1/public/leaderboard');
    await assertFails(setDoc(reference, { entries, updatedAt: past }));
    await assertFails(setDoc(reference, { entries, updatedAt: serverTimestamp(), answers: [] }));
  });
  it('最後一筆缺欄位、非 map 或型別錯誤都拒絕', async () => {
    for (const invalid of [null, 'invalid', { nickname: '小明' },
      { nickname: '小明', score: 1.5 }, { nickname: 123, score: 1 },
      { nickname: '小明', score: '1' }, { nickname: '小明', score: 1, rank: 1 }]) {
      await assertFails(snapshot(teacher(), [...entries.slice(0, 29), invalid]));
    }
  });
  it('兩頁必須成對原子更新，禁止未知頁面與單頁更新', async () => {
    const db = teacher();
    await assertFails(setDoc(doc(db, 'rooms/r1/public/leaderboard'), { entries: [], updatedAt: serverTimestamp() }));
    await assertSucceeds(snapshot(db));
    await assertFails(setDoc(doc(db, 'rooms/r1/public/leaderboard2'), { entries: [], updatedAt: serverTimestamp() }));
    await assertFails(setDoc(doc(db, 'rooms/r1/public/leaderboard3'), { entries: [], updatedAt: serverTimestamp() }));
    await assertSucceeds(snapshot(db, []));
  });
});
