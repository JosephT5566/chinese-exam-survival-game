import { readFileSync, writeFileSync } from 'node:fs';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import type { RulesTestContext, RulesTestEnvironment, TokenOptions } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, setDoc,
  Timestamp, updateDoc, where, writeBatch } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

let env: RulesTestEnvironment;
type Firestore = ReturnType<RulesTestContext['firestore']>;
const past = Timestamp.fromMillis(1_700_000_000_000);
const recent = () => Timestamp.fromMillis(Date.now() - 1000);
const order = Array.from({ length: 40 }, (_, i) => `q${i + 1}`);
const choices = Object.fromEntries(order.map((id) => [id, [0, 1, 2, 3]]));
function room(ownerUid = 't1', status = 'running', code = 'ABC123') {
  return { ownerUid, status, code, questionSetVersion: 'provisional-v1', rulesVersion: 2,
    durationMinutes: 20, remainingMs: 1200000, runningSince: status === 'running' ? recent() : null,
    pausedAt: null, playerCount: 2, createdAt: past, updatedAt: past,
    startedAt: status === 'lobby' ? null : past, endedAt: null };
}
function player() {
  return { nickname: '小明', joinedAt: past, questionOrder: order, choiceOrders: choices,
    completedCount: 0, revision: 0, lastOperation: null, finishedAt: null, cooldownStartedAt: null, pendingId: null };
}
function publicScore(score = 0, nickname = '小明') { return { nickname, score, lastOperation: null }; }
function student(uid = 's1') {
  return env.authenticatedContext(uid, { firebase: { sign_in_provider: 'anonymous' } }).firestore();
}
function teacher(uid = 't1') {
  return env.authenticatedContext(uid, { email: `${uid}@example.test`, email_verified: true,
    firebase: { sign_in_provider: 'google.com' } }).firestore();
}
function playerRef(db: Firestore, uid = 's1') { return doc(db, `rooms/r1/players/${uid}`); }
function scoreRef(db: Firestore, uid = 's1') { return doc(db, `rooms/r1/scores/${uid}`); }
function answerRef(db: Firestore, id = 'q1', uid = 's1') { return doc(db, `rooms/r1/players/${uid}/answers/${id}`); }
async function seed(path: string, data: Record<string, unknown>) {
  await env.withSecurityRulesDisabled(async (context) => { await setDoc(doc(context.firestore(), path), data); });
}
function answer(correct = true, ordinal = 1) {
  return { ordinal, selectedChoice: 0, isCorrect: correct, explanationViewed: false, awardedPoints: 0,
    answeredAt: serverTimestamp(), explanationViewedAt: null, chest: null };
}
function answerBatch(db: Firestore, { id = 'q1', ordinal = 1, correct = true, revision = 1 } = {}) {
  const batch = writeBatch(db);
  batch.set(answerRef(db, id), answer(correct, ordinal));
  batch.update(playerRef(db), { completedCount: ordinal, revision, lastOperation: { kind: 'answer', id },
    pendingId: correct ? id : null, cooldownStartedAt: correct ? null : serverTimestamp(), finishedAt: null });
  return batch;
}
function chest(kind = 'gain', amount = 80) {
  return { box: 0, outcome: { kind, amount }, targetId: null, settled: false, delta: 0, fallback: false };
}
function openBatch(db: Firestore, c = chest(), id = 'q1', revision = 2) {
  const batch = writeBatch(db);
  batch.update(answerRef(db, id), { chest: c });
  batch.update(playerRef(db), { revision, lastOperation: { kind: 'open', id } });
  return batch;
}
function claimBatch(db: Firestore, { c = chest(), targetId = null, own = 80,
  other = 0, delta = 80, fallback = false, id = 'q1', revision = 3, final = false }: {
    c?: ReturnType<typeof chest>; targetId?: string | null; own?: number; other?: number; delta?: number;
    fallback?: boolean; id?: string; revision?: number; final?: boolean;
  } = {}) {
  const batch = writeBatch(db);
  batch.update(answerRef(db, id), { chest: { ...c, targetId, settled: true, delta, fallback } });
  batch.update(playerRef(db), { revision, lastOperation: { kind: 'claim', id }, pendingId: null,
    finishedAt: final ? serverTimestamp() : null });
  batch.update(scoreRef(db), { score: own, lastOperation: { actor: 's1', id } });
  if (targetId !== null) batch.update(scoreRef(db, targetId), { score: other, lastOperation: { actor: 's1', id } });
  return batch;
}
async function prepare(c = chest(), own = 0, other = 0) {
  await seed('rooms/r1/scores/s1', publicScore(own));
  await seed('rooms/r1/scores/s2', publicScore(other, '小華'));
  await assertSucceeds(answerBatch(student()).commit());
  await assertSucceeds(openBatch(student(), c).commit());
}
function joinBatch(db: Firestore, uid = 'new') {
  const batch = writeBatch(db);
  batch.set(playerRef(db, uid), { ...player(), joinedAt: serverTimestamp() });
  batch.set(scoreRef(db, uid), publicScore());
  batch.update(doc(db, 'rooms/r1'), { playerCount: 3 });
  return batch;
}
beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-chinese-exam', firestore: {
    host: '127.0.0.1', port: 8080, rules: readFileSync('firestore.rules', 'utf8') } });
});
afterAll(async () => {
  try {
    const path = process.env.RULES_COVERAGE_PATH;
    if (path) {
      const response = await fetch('http://127.0.0.1:8080/emulator/v1/projects/demo-chinese-exam:ruleCoverage');
      if (!response.ok) throw new Error(`Coverage HTTP ${response.status}`);
      writeFileSync(path, await response.text());
    }
  } finally { await env?.cleanup(); }
});
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const batch = writeBatch(db);
    batch.set(doc(db, 'teacherEmails/t1@example.test'), { authorized: true });
    batch.set(doc(db, 'teacherEmails/t2@example.test'), { authorized: true });
    batch.set(doc(db, 'rooms/r1'), room());
    batch.set(doc(db, 'rooms/r2'), room('t2', 'running', 'DEF456'));
    batch.set(doc(db, 'roomCodes/ABC123'), { roomId: 'r1', ownerUid: 't1' });
    for (const [uid, nickname] of [['s1', '小明'], ['s2', '小華']]) {
      batch.set(playerRef(db, uid), { ...player(), nickname });
      batch.set(scoreRef(db, uid), publicScore(0, nickname));
    }
    await batch.commit();
  });
});

describe('身分與私人資料', () => {
  it('驗證過的 Google email 不分大小寫，但其他 provider 與缺少驗證都拒絕', async () => {
    const claims = { email: 'T1@EXAMPLE.TEST', email_verified: true, firebase: { sign_in_provider: 'google.com' } } satisfies TokenOptions;
    await assertSucceeds(getDoc(doc(env.authenticatedContext('t1', claims).firestore(), 'rooms/r1')));
    const invalid: TokenOptions[] = [
      { ...claims, email_verified: false },
      { email: claims.email, firebase: claims.firebase },
      { email_verified: true, firebase: claims.firebase },
      { ...claims, email: 'outsider@example.test' },
      { ...claims, firebase: { sign_in_provider: 'password' } },
      { ...claims, firebase: { sign_in_provider: 'anonymous' } },
    ];
    for (const token of invalid) await assertFails(getDoc(doc(env.authenticatedContext('t1', token).firestore(), 'rooms/r1')));
  });
  it('相同 email 的另一個 UID 可獲老師資格，但不能繼承原 UID 的教室', async () => {
    const db = env.authenticatedContext('new-uid', { email: 't1@example.test', email_verified: true,
      firebase: { sign_in_provider: 'google.com' } }).firestore();
    await assertSucceeds(getDoc(doc(db, 'teacherEmails/t1@example.test')));
    await assertFails(getDoc(doc(db, 'rooms/r1')));
  });
  it('舊 UID 白名單不能授權，其他 email 的文件不能讀取', async () => {
    await seed('teachers/outsider', { authorized: true });
    await assertFails(getDoc(doc(teacher('outsider'), 'rooms/r1')));
    await assertFails(getDoc(doc(teacher(), 'teacherEmails/t2@example.test')));
    await assertFails(getDoc(doc(teacher(), 'teachers/t1')));
  });

  it('Google + allowlist 的老師可讀自己的授權與房間', async () => {
    await assertSucceeds(getDoc(doc(teacher(), 'teacherEmails/t1@example.test')));
    await assertSucceeds(getDoc(doc(teacher(), 'rooms/r1')));
  });
  it('未核准 Google、匿名冒用老師 UID 都不能管理房間', async () => {
    await assertFails(getDoc(doc(teacher('outsider'), 'rooms/r1')));
    await assertFails(getDoc(doc(student('t1'), 'rooms/r1')));
  });
  it('客戶端不能自授權、修改或刪除 allowlist', async () => {
    await assertFails(setDoc(doc(teacher('outsider'), 'teacherEmails/outsider@example.test'), { authorized: true }));
    await assertFails(updateDoc(doc(teacher(), 'teacherEmails/t1@example.test'), { authorized: false }));
    await assertFails(deleteDoc(doc(teacher(), 'teacherEmails/t1@example.test')));
  });
  it('撤銷 allowlist 後，Google 老師立即失去房間權限', async () => {
    await seed('teacherEmails/t1@example.test', { authorized: false });
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
    await assertFails(getDocs(collection(teacher(), 'teacherEmails')));
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

describe('v2 房間與原子加入', () => {
  function createRoom(db: Firestore, code = 'NEW123', ownerUid = 't1') {
    const batch = writeBatch(db);
    batch.set(doc(db, 'rooms/new'), { ...room(ownerUid, 'lobby', code), playerCount: 0,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    batch.set(doc(db, `roomCodes/${code}`), { ownerUid, roomId: 'new' });
    return batch;
  }
  it('教師原子建立房間，學生與假 owner 無法建房', async () => {
    await assertSucceeds(createRoom(teacher()).commit());
    await assertFails(createRoom(student(), 'NEW124').commit());
    await assertFails(createRoom(teacher(), 'NEW125', 't2').commit());
    await assertFails(updateDoc(doc(teacher(), 'roomCodes/ABC123'), { roomId: 'r2' }));
  });
  it('加入必須同時建立私人進度、公開零分並正確加一人數，不能重複加入', async () => {
    await seed('rooms/r1', room('t1', 'lobby'));
    const db = student('new');
    await assertFails(setDoc(playerRef(db, 'new'), { ...player(), joinedAt: serverTimestamp() }));
    await assertFails(setDoc(scoreRef(db, 'new'), publicScore()));
    await assertFails(updateDoc(doc(db, 'rooms/r1'), { playerCount: 3 }));
    const bad = joinBatch(db); bad.update(doc(db, 'rooms/r1'), { playerCount: 4 });
    await assertFails(bad.commit());
    const badScore = joinBatch(db); badScore.update(scoreRef(db, 'new'), { score: 20 });
    await assertFails(badScore.commit());
    await assertSucceeds(joinBatch(db).commit());
    await assertFails(joinBatch(db).commit());
  });
  it('未加入匿名學生可讀 lobby metadata，但不能列房間或讀私人文件與公開分數', async () => {
    await seed('rooms/r1', room('t1', 'lobby'));
    const db = student('new');
    await assertSucceeds(getDoc(doc(db, 'rooms/r1')));
    await assertFails(getDocs(collection(db, 'rooms')));
    await assertFails(getDoc(playerRef(db)));
    await assertFails(getDoc(scoreRef(db)));
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'rooms/r1')));
    await assertFails(getDoc(doc(teacher('outsider'), 'rooms/r1')));
    await seed('rooms/r1', room());
    await assertFails(getDoc(doc(db, 'rooms/r1')));
  });
  it('30 人上限、非匿名身分、無效索引與非 lobby 禁止加入', async () => {
    for (const status of ['running', 'paused', 'ended', 'archived']) {
      await seed('rooms/r1', room('t1', status));
      await assertFails(joinBatch(student('new')).commit());
    }
    await seed('rooms/r1', { ...room('t1', 'lobby'), playerCount: 30 });
    await assertFails(joinBatch(student('new')).commit());
    await seed('rooms/r1', room('t1', 'lobby'));
    await assertFails(joinBatch(teacher('new')).commit());
    await seed('roomCodes/ABC123', { roomId: 'r2', ownerUid: 't2' });
    await assertFails(joinBatch(student('new')).commit());
  });
  it('教師可設定時間、開始、精確暫停恢復、結束封存', async () => {
    await seed('rooms/r1', room('t1', 'lobby'));
    const ref = doc(teacher(), 'rooms/r1');
    await assertFails(updateDoc(ref, { durationMinutes: 0, remainingMs: 0, updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(ref, { durationMinutes: 1, remainingMs: 60000, updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(ref, { status: 'running', startedAt: serverTimestamp(), runningSince: serverTimestamp(), updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { status: 'paused', runningSince: null, updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(ref, { status: 'paused', pausedAt: serverTimestamp(), updatedAt: serverTimestamp() }));
    const paused = (await getDoc(ref)).data();
    const elapsed = Math.floor(paused?.pausedAt.toMillis() - paused?.runningSince.toMillis());
    await assertFails(updateDoc(ref, { status: 'running', remainingMs: 60001, pausedAt: null, runningSince: serverTimestamp(), updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(ref, { status: 'running', remainingMs: 60000 - elapsed, pausedAt: null, runningSince: serverTimestamp(), updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(ref, { status: 'ended', remainingMs: 0, runningSince: null, pausedAt: null, endedAt: serverTimestamp(), updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(ref, { status: 'archived', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { status: 'running', runningSince: serverTimestamp(), updatedAt: serverTimestamp() }));
  });
  it('到期禁止作答、暫停、恢復或加時間，允許教師結束', async () => {
    await seed('rooms/r1', { ...room(), runningSince: past, remainingMs: 1 });
    await assertFails(answerBatch(student()).commit());
    await assertFails(updateDoc(doc(teacher(), 'rooms/r1'), { status: 'paused', pausedAt: serverTimestamp(), updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(teacher(), 'rooms/r1'), { remainingMs: 3600000, updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(doc(teacher(), 'rooms/r1'), { status: 'ended', remainingMs: 0, runningSince: null, pausedAt: null, endedAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  });
  it('舊版本房間仍可讀，不能作答、加入、改房間', async () => {
    const { rulesVersion: _v, ...legacy } = room('t1', 'lobby');
    await seed('rooms/r1', legacy);
    await assertSucceeds(getDoc(doc(student(), 'rooms/r1')));
    await seed('rooms/r1/players/s1/events/1', { eventIndex: 1, awardedPoints: 80, createdAt: past });
    await assertSucceeds(getDoc(doc(student(), 'rooms/r1/players/s1/events/1')));
    await assertFails(getDoc(doc(student('s2'), 'rooms/r1/players/s1/events/1')));
    await assertFails(updateDoc(doc(student(), 'rooms/r1/players/s1/events/1'), { awardedPoints: 100 }));
    await assertFails(joinBatch(student('new')).commit());
    await assertFails(answerBatch(student()).commit());
    await assertFails(updateDoc(doc(teacher(), 'rooms/r1'), { status: 'ended', updatedAt: serverTimestamp() }));
  });
});

describe('v2 作答、冷卻、寶箱與公開分數', () => {
  it('答案不加分且必須原子更新進度，不可跳題或重答', async () => {
    const db = student();
    await assertFails(setDoc(answerRef(db), answer()));
    await assertFails(answerBatch(db, { id: 'q2', ordinal: 2 }).commit());
    const invalidChoice = answerBatch(db); invalidChoice.update(answerRef(db), { selectedChoice: 4 });
    await assertFails(invalidChoice.commit());
    const invalidAward = answerBatch(db); invalidAward.update(answerRef(db), { awardedPoints: 100 });
    await assertFails(invalidAward.commit());
    const twoAnswers = answerBatch(db); twoAnswers.set(answerRef(db, 'q2'), answer(true, 2));
    await assertFails(twoAnswers.commit());
    await assertSucceeds(answerBatch(db).commit());
    expect((await getDoc(scoreRef(db))).data()?.score).toBe(0);
    await assertFails(answerBatch(db).commit());
    await assertFails(answerBatch(db, { id: 'q2', ordinal: 2, revision: 2 }).commit());
    await assertFails(updateDoc(answerRef(db), { selectedChoice: 1 }));
  });
  it('錯題只冷卻 3 秒，不能開箱或領詳解分，未滿冷卻不能前進', async () => {
    const db = student();
    await assertSucceeds(answerBatch(db, { correct: false }).commit());
    await assertFails(openBatch(db).commit());
    await assertFails(answerBatch(db, { id: 'q2', ordinal: 2, revision: 2 }).commit());
    await assertFails(updateDoc(answerRef(db), { explanationViewed: true, awardedPoints: 20 }));
    await seed('rooms/r1/players/s1', { ...player(), completedCount: 1, revision: 1, cooldownStartedAt: past });
    await assertSucceeds(answerBatch(db, { id: 'q2', ordinal: 2, revision: 2 }).commit());
  });
  it('開箱僅能一次，outcome、box 不可重抽，不能直接領取或假冒分數', async () => {
    const db = student();
    await assertSucceeds(answerBatch(db).commit());
    await assertFails(claimBatch(db).commit());
    await assertFails(openBatch(db, chest('gain', 81)).commit());
    const invalidBox = openBatch(db, { ...chest(), box: 3 });
    await assertFails(invalidBox.commit());
    await assertSucceeds(openBatch(db).commit());
    await assertFails(openBatch(db, chest('loss', 30), 'q1', 3).commit());
    await assertFails(updateDoc(scoreRef(db), { score: 80, lastOperation: { actor: 's1', id: 'q1' } }));
    await assertFails(claimBatch(db, { c: { ...chest(), box: 1 } }).commit());
    await assertFails(claimBatch(db, { own: 81, delta: 81 }).commit());
    const leaked = claimBatch(db); leaked.update(scoreRef(db), { answers: ['private'] });
    await assertFails(leaked.commit());
    const renamed = claimBatch(db); renamed.update(scoreRef(db), { nickname: '偽造' });
    await assertFails(renamed.commit());
    const extraScore = claimBatch(db); extraScore.update(scoreRef(db, 's2'), { score: 80, lastOperation: { actor: 's1', id: 'q1' } });
    await assertFails(extraScore.commit());
    await assertSucceeds(claimBatch(db).commit());
    await assertFails(claimBatch(db, { revision: 4, own: 160 }).commit());
    expect((await getDoc(scoreRef(db))).data()?.score).toBe(80);
  });
  for (const [kind, amount, ownBefore, ownAfter] of [
    ['gain', 20, 0, 20], ['gain', 50, 10, 60], ['gain', 80, 0, 80],
    ['loss', 10, 50, 40], ['loss', 20, 10, 0], ['loss', 30, 0, 0],
  ] satisfies [string, number, number, number][]) {
    it(`${kind} ${amount} 精確計分並歸零`, async () => {
      const c = chest(kind, amount); await prepare(c, ownBefore);
      await assertSucceeds(claimBatch(student(), { c, own: ownAfter, delta: ownAfter - ownBefore }).commit());
    });
  }
  for (const [kind, ownBefore, otherBefore, ownAfter, otherAfter] of [
    ['steal', 10, 200, 110, 100], ['steal', 10, 30, 40, 0], ['steal', 10, 0, 10, 0],
    ['swap', 10, 200, 200, 10], ['swap', 10, 0, 0, 10],
  ] satisfies [string, number, number, number, number][]) {
    it(`${kind} 保持雙方分數守恆 ${ownBefore}/${otherBefore}`, async () => {
      const c = chest(kind, 0); await prepare(c, ownBefore, otherBefore);
      await assertFails(claimBatch(student(), { c, targetId: 's2', own: ownAfter + 1, other: otherAfter, delta: ownAfter + 1 - ownBefore }).commit());
      await assertSucceeds(claimBatch(student(), { c, targetId: 's2', own: ownAfter, other: otherAfter, delta: ownAfter - ownBefore }).commit());
      expect((await getDoc(scoreRef(student(), 's2'))).data()?.score).toBe(otherAfter);
    });
  }
  it('公開分數可讀取但私人答案與進度不能跨人洩露', async () => {
    await prepare(chest('steal', 0), 10, 80);
    await assertSucceeds(getDocs(collection(student(), 'rooms/r1/scores')));
    await assertFails(getDoc(playerRef(student(), 's2')));
    await assertFails(getDoc(answerRef(student(), 'q1', 's2')));
    await assertFails(getDoc(scoreRef(student('outsider'))));
    await assertFails(getDoc(scoreRef(teacher('t2'))));
    await assertSucceeds(claimBatch(student(), { c: chest('steal', 0), targetId: 's2', own: 90, other: 0, delta: 80 }).commit());
    await assertFails(getDoc(playerRef(student(), 's2')));
  });
  it('跨房、自選本人、缺少目標、多人時 fallback、只更新單方都拒絕', async () => {
    const c = chest('steal', 0); await prepare(c, 10, 80);
    await seed('rooms/r2/scores/outsider', publicScore(100));
    await assertFails(claimBatch(student(), { c, targetId: 's1', own: 10, other: 10, delta: 0 }).commit());
    await assertFails(claimBatch(student(), { c, targetId: 'outsider', own: 110, other: 0, delta: 100 }).commit());
    await assertFails(claimBatch(student(), { c, own: 30, delta: 20, fallback: true }).commit());
    const db = student();
    const missing = writeBatch(db);
    missing.update(answerRef(db), { chest: { ...c, targetId: 's2', settled: true, delta: 80 } });
    missing.update(playerRef(db), { revision: 3, pendingId: null, lastOperation: { kind: 'claim', id: 'q1' } });
    missing.update(scoreRef(db), { score: 90, lastOperation: { actor: 's1', id: 'q1' } });
    await assertFails(missing.commit());
  });
  for (const kind of ['steal', 'swap']) {
    it(`單人 ${kind} fallback 恰加 20`, async () => {
      const c = chest(kind, 0); await prepare(c, 10);
      await seed('rooms/r1', { ...room(), playerCount: 1 });
      await assertFails(claimBatch(student(), { c, own: 30, delta: 20, fallback: false }).commit());
      await assertSucceeds(claimBatch(student(), { c, own: 30, delta: 20, fallback: true }).commit());
    });
  }
  for (const status of ['lobby', 'paused', 'ended', 'archived']) {
    it(`${status} 禁止答題、開箱、領取，既有答案可讀`, async () => {
      await prepare(); await seed('rooms/r1', room('t1', status));
      await assertFails(answerBatch(student(), { id: 'q2', ordinal: 2, revision: 3 }).commit());
      await assertFails(openBatch(student(), chest(), 'q1', 3).commit());
      await assertFails(claimBatch(student()).commit());
      await assertSucceeds(getDoc(answerRef(student())));
    });
  }
  it('沒有原子答案或公開分數的假 claim、改受害者私人進度都拒絕', async () => {
    const c = chest('swap', 0); await prepare(c, 20, 80);
    const db = student();
    await assertFails(updateDoc(playerRef(db), { revision: 3, pendingId: null, lastOperation: { kind: 'claim', id: 'q1' } }));
    const tamper = claimBatch(db, { c, targetId: 's2', own: 80, other: 20, delta: 60 });
    tamper.update(playerRef(db, 's2'), { completedCount: 1, revision: 1 });
    await assertFails(tamper.commit());
    const badCounterpart = claimBatch(db, { c, targetId: 's2', own: 80, other: 21, delta: 60 });
    await assertFails(badCounterpart.commit());
    const mismatchedWitness = claimBatch(db, { c, targetId: 's2', own: 80, other: 20, delta: 60 });
    mismatchedWitness.update(scoreRef(db, 's2'), { lastOperation: { actor: 's2', id: 'q1' } });
    await assertFails(mismatchedWitness.commit());
    await assertSucceeds(claimBatch(db, { c, targetId: 's2', own: 80, other: 20, delta: 60 }).commit());
  });
  it('得分上限與整數限制拒絕溢位，不能自行寫負數或小數', async () => {
    await prepare(chest(), 95921);
    await assertFails(claimBatch(student(), { own: 96001, delta: 80 }).commit());
    await assertFails(updateDoc(scoreRef(student()), { score: -1 }));
    await assertFails(updateDoc(scoreRef(student()), { score: 1.5 }));
    await seed('rooms/r1/scores/s1', publicScore(95920));
    await assertSucceeds(claimBatch(student(), { own: 96000, delta: 80 }).commit());
  });
  it('並發領同一寶箱只能成功一次', async () => {
    await prepare(); const db = student();
    const results = await Promise.allSettled([claimBatch(db).commit(), claimBatch(db).commit()]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect((await getDoc(scoreRef(db))).data()?.score).toBe(80);
  });
  it('到期不能開箱或領取，不能更改原答案或受害者進度', async () => {
    await prepare(); await seed('rooms/r1', { ...room(), runningSince: past, remainingMs: 1 });
    await assertFails(claimBatch(student()).commit());
    await assertFails(openBatch(student(), chest(), 'q1', 3).commit());
    await assertFails(updateDoc(playerRef(student(), 's2'), { revision: 1 }));
  });
  it('第 40 題正確需領完寶箱才完成，不可第 41 題', async () => {
    await seed('rooms/r1/players/s1', { ...player(), completedCount: 39, revision: 117 });
    const db = student();
    await assertSucceeds(answerBatch(db, { id: 'q40', ordinal: 40, revision: 118 }).commit());
    expect((await getDoc(playerRef(db))).data()?.finishedAt).toBeNull();
    await assertSucceeds(openBatch(db, chest(), 'q40', 119).commit());
    await assertSucceeds(claimBatch(db, { id: 'q40', revision: 120, final: true }).commit());
    expect((await getDoc(playerRef(db))).data()?.finishedAt).toBeInstanceOf(Timestamp);
    await assertFails(answerBatch(db, { id: 'q41', ordinal: 41, revision: 121 }).commit());
  });
  it('第 40 題錯誤在冷卻結束後 finish 操作完成，不能提前或重複完成', async () => {
    await seed('rooms/r1/players/s1', { ...player(), completedCount: 39, revision: 39 });
    const db = student();
    await assertSucceeds(answerBatch(db, { id: 'q40', ordinal: 40, revision: 40, correct: false }).commit());
    const patch = { revision: 41, lastOperation: { kind: 'finish', id: 'q40' }, finishedAt: serverTimestamp() };
    await assertFails(updateDoc(playerRef(db), patch));
    await seed('rooms/r1/players/s1', { ...player(), completedCount: 40, revision: 40, cooldownStartedAt: past });
    await assertSucceeds(updateDoc(playerRef(db), patch));
    await assertFails(updateDoc(playerRef(db), { ...patch, revision: 42 }));
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
  it('舊房間快照可讀但不能再發布', async () => {
    await assertSucceeds(snapshot(teacher()));
    const { rulesVersion: _v, ...legacy } = room();
    await seed('rooms/r1', legacy);
    await assertSucceeds(getDoc(doc(student(), 'rooms/r1/public/leaderboard')));
    await assertFails(snapshot(teacher()));
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

describe('room retirement and cleanup', () => {
  function begin(db: Firestore) {
    const batch = writeBatch(db);
    batch.update(doc(db, 'rooms/r1'), { status: 'deleting', updatedAt: serverTimestamp() });
    batch.set(doc(db, 'retiredRoomCodes/ABC123'), { roomId: 'r1', ownerUid: 't1', state: 'deleting' });
    batch.delete(doc(db, 'roomCodes/ABC123'));
    return batch.commit();
  }
  it('atomically retires a lobby code and grants cleanup only to its authorized owner', async () => {
    await seed('rooms/r1', room('t1', 'lobby'));
    await assertFails(begin(student()));
    await assertFails(begin(teacher('t2')));
    await assertFails(updateDoc(doc(teacher(), 'rooms/r1'), { status: 'deleting', updatedAt: serverTimestamp() }));
    await assertSucceeds(begin(teacher()));
    await assertFails(joinBatch(student('new')).commit());
    await assertFails(answerBatch(student()).commit());
    await assertFails(updateDoc(doc(teacher(), 'rooms/r1'), { status: 'ended', updatedAt: serverTimestamp() }));
    await assertFails(deleteDoc(playerRef(student())));
    await assertSucceeds(deleteDoc(answerRef(teacher())));
    await assertSucceeds(deleteDoc(playerRef(teacher())));
    await seed('teacherEmails/t1@example.test', { authorized: false });
    await assertFails(deleteDoc(scoreRef(teacher())));
  });
  for (const status of ['running', 'paused']) it(`does not retire a v2 ${status} room`, async () => {
    await seed('rooms/r1', room('t1', status));
    await assertFails(begin(teacher()));
    expect((await getDoc(doc(student(), 'roomCodes/ABC123'))).exists()).toBe(true);
  });
  it('allows readonly legacy cleanup without allowing unknown versions', async () => {
    const { rulesVersion: _version, ...legacy } = room();
    await seed('rooms/r1', legacy);
    await assertSucceeds(begin(teacher()));
    await seed('rooms/r1', { ...room(), rulesVersion: 3 });
    await assertFails(begin(teacher()));
  });
  it('requires durable completion with final deletion and prevents reuse of a retired code', async () => {
    await seed('rooms/r1', room('t1', 'ended'));
    await assertSucceeds(begin(teacher()));
    await assertFails(deleteDoc(doc(teacher(), 'rooms/r1')));
    const db = teacher();
    const final = writeBatch(db);
    final.delete(doc(db, 'rooms/r1'));
    final.update(doc(db, 'retiredRoomCodes/ABC123'), { state: 'completed' });
    await assertSucceeds(final.commit());
    expect((await getDoc(doc(teacher(), 'retiredRoomCodes/ABC123'))).data()?.state).toBe('completed');
    await assertFails(deleteDoc(doc(teacher(), 'retiredRoomCodes/ABC123')));
    const recreate = writeBatch(db);
    recreate.set(doc(db, 'rooms/reused'), { ...room('t1', 'lobby'), playerCount: 0, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), startedAt: null });
    recreate.set(doc(db, 'roomCodes/ABC123'), { roomId: 'reused', ownerUid: 't1' });
    await assertFails(recreate.commit());
  });
});
