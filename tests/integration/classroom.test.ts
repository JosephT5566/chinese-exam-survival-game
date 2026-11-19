import { readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { initializeApp, deleteApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInAnonymously, signInWithCredential, GoogleAuthProvider } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore, getDocFromServer, doc, collection, getDocsFromServer, terminate, Timestamp } from 'firebase/firestore';
import { Classroom } from '../../src/firebase/classroom';
import { parseAnswer, parseRoom, questionSetVersion, type CloudPlayer } from '../../src/firebase/model';
import { questions } from '../../src/questions/bank';
import type { ChestOutcome } from '../../src/game/rewards';

const project = 'demo-chinese-exam';
let env: RulesTestEnvironment;
const apps: FirebaseApp[] = [];
async function client(teacher = false, email = 'teacher@example.test') {
  const app = initializeApp({ projectId: project, apiKey: 'demo-key' }, `integration-${apps.length}`);
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const db = getFirestore(app);
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  const result = teacher ? await signInWithCredential(auth, GoogleAuthProvider.credential(JSON.stringify({
    sub: email, email, email_verified: true,
  }))) : await signInAnonymously(auth);
  return { db, user: result.user, uid: result.user.uid, classroom: new Classroom(db, result.user) };
}
type TestClient = Awaited<ReturnType<typeof client>>;
async function fixture(count = 2) {
  const teacher = await client(true);
  await env.withSecurityRulesDisabled(async context => {
    await context.firestore().doc('teacherEmails/teacher@example.test').set({ authorized: true });
  });
  const room = await teacher.classroom.createRoom(2);
  const students: { actor: TestClient; player: CloudPlayer }[] = [];
  for (let index = 0; index < count; index++) {
    const actor = await client();
    const { player } = await actor.classroom.joinRoom(room.code, `同學${index + 1}`);
    students.push({ actor, player });
  }
  return { teacher, room, students };
}
function question(player: CloudPlayer, index = 0) {
  const id = player.order[index];
  if (!id) throw new Error('Missing question');
  const correct = player.choices[id]?.indexOf(questions.get(id)!.correctChoiceIndex);
  if (correct === undefined || correct < 0) throw new Error('Missing correct choice');
  return { id, correct, wrong: (correct + 1) % 4 };
}
async function readAnswer(actor: TestClient, roomId: string, id: string) {
  return parseAnswer((await getDocFromServer(doc(actor.db, `rooms/${roomId}/players/${actor.uid}/answers/${id}`))).data());
}
async function publicScores(actor: TestClient, roomId: string) {
  const snapshot = await getDocsFromServer(collection(actor.db, `rooms/${roomId}/scores`));
  return new Map(snapshot.docs.map(document => [document.id, Number(document.data().score)]));
}
async function prepareChest(roomId: string, student: { actor: TestClient; player: CloudPlayer }, outcome: ChestOutcome, index = 0) {
  const { id, correct } = question(student.player, index);
  await student.actor.classroom.submitAnswer(roomId, id, correct);
  await student.actor.classroom.openChest(roomId, id, 1);
  // Seed only the random draw; the SDK and rules still perform every settlement.
  await env.withSecurityRulesDisabled(async context => {
    await context.firestore().doc(`rooms/${roomId}/players/${student.actor.uid}/answers/${id}`).update({ 'chest.outcome': outcome });
  });
  return id;
}
async function seedScores(roomId: string, students: { actor: TestClient }[], values: number[]) {
  await env.withSecurityRulesDisabled(async context => {
    const batch = context.firestore().batch();
    students.forEach((student, index) => batch.update(context.firestore().doc(`rooms/${roomId}/scores/${student.actor.uid}`), { score: values[index] }));
    await batch.commit();
  });
}
beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: project, firestore: { host: '127.0.0.1', port: 8080,
    rules: readFileSync('firestore.rules', 'utf8') } });
  await env.clearFirestore();
});
afterAll(async () => {
  await Promise.all(apps.map(async app => { await terminate(getFirestore(app)); await deleteApp(app); }));
  await env?.cleanup();
});

describe('real classroom adapter against Auth, Firestore and rules', () => {
  it('admin grants email before first login, dry-runs and applies idempotently', async () => {
    const args = ['scripts/authorize-teachers.mjs', '--emulator', '--project', project, '--email', ' Prelogin@Example.Test '];
    const run = promisify(execFile);
    await run(process.execPath, args);
    const teacher = await client(true, 'prelogin@example.test');
    expect(await teacher.classroom.isTeacher()).toBe(false);
    await run(process.execPath, [...args, '--apply']);
    expect(await teacher.classroom.isTeacher()).toBe(true);
    await run(process.execPath, [...args, '--apply']);
    expect(await teacher.classroom.isTeacher()).toBe(true);
    await run(process.execPath, [...args.slice(0, -1), 'future@example.test', '--apply']);
    expect(await (await client(true, 'future@example.test')).classroom.isTeacher()).toBe(true);
  });
  it('environment sync handles pagination, revocation, dry-run, invalid inputs and explicit empty arrays', async () => {
    const run = promisify(execFile);
    const args = ['scripts/authorize-teachers.mjs', '--emulator', '--project', project, '--sync-env'];
    const sync = (emails: string[], apply = true) => run(process.execPath, apply ? [...args, '--apply'] : args,
      { env: { ...process.env, TEACHER_EMAILS: JSON.stringify(emails) } });
    const emails = Array.from({ length: 60 }, (_, n) => `bulk${n}@example.test`);
    await sync(emails);
    const teacher = await client(true, emails[0]);
    expect(await teacher.classroom.isTeacher()).toBe(true);
    await sync(['kept@example.test'], false);
    expect(await teacher.classroom.isTeacher()).toBe(true);
    for (const value of ['', '["bad"]', '[1]']) {
      await expect(run(process.execPath, [...args, '--apply'], { env: { ...process.env, TEACHER_EMAILS: value } })).rejects.toMatchObject({ code: 1 });
      expect(await teacher.classroom.isTeacher()).toBe(true);
    }
    await sync(['Kept@Example.Test']);
    expect(await teacher.classroom.isTeacher()).toBe(false);
    const kept = await client(true, 'kept@example.test');
    expect(await kept.classroom.isTeacher()).toBe(true);
    const repeated = await sync(['kept@example.test']);
    expect(repeated.stdout).toContain('0 email grant(s), 0 removal(s)');
    await env.withSecurityRulesDisabled(async context => {
      expect((await context.firestore().collection('teacherEmails').get()).size).toBe(1);
      await context.firestore().doc('teachers/old-uid').set({ authorized: true });
    });
    await env.withSecurityRulesDisabled(async context => {
      const batch = context.firestore().batch();
      for (let i = 0; i < 100; i++) batch.set(context.firestore().doc(`teacherEmails/overflow${i}@example.test`), { authorized: true });
      await batch.commit();
    });
    await expect(sync([])).rejects.toMatchObject({ code: 1 });
    expect(await kept.classroom.isTeacher()).toBe(true);
    await env.withSecurityRulesDisabled(async context => {
      const documents = await context.firestore().collection('teacherEmails').get();
      expect(documents.size).toBe(101);
      const batch = context.firestore().batch();
      for (const document of documents.docs) if (document.id !== 'kept@example.test') batch.delete(document.ref);
      await batch.commit();
    });
    await sync([]);
    expect(await kept.classroom.isTeacher()).toBe(false);
    await env.withSecurityRulesDisabled(async context => {
      expect((await context.firestore().collection('teacherEmails').get()).size).toBe(0);
      expect((await context.firestore().doc('teachers/old-uid').get()).exists).toBe(true);
    });
  });
  it('persists concurrent answer/open/claim once, reconnects, and exposes only public scores', async () => {
    const { teacher, room, students } = await fixture();
    const first = students[0]!, second = students[1]!;
    const student = first.actor, other = second.actor;
    expect(room.rulesVersion).toBe(2);
    expect(room.questionSetVersion).toBe(questionSetVersion);
    expect((await student.classroom.resumeRoom(room.code))?.room.playerCount).toBe(2);
    expect(await (await client()).classroom.resumeRoom(room.code)).toBeNull();
    await expect(getDocFromServer(doc(other.db, `rooms/${room.id}/players/${student.uid}`))).rejects.toThrow();
    await expect(getDocsFromServer(collection(student.db, `rooms/${room.id}/players`))).rejects.toThrow();
    const exposed = await getDocsFromServer(collection(student.db, `rooms/${room.id}/scores`));
    expect(exposed.size).toBe(2);
    exposed.docs.forEach(document => expect(Object.keys(document.data()).sort()).toEqual(['lastOperation', 'nickname', 'score']));
    const stranger = await client();
    await expect(getDocsFromServer(collection(stranger.db, `rooms/${room.id}/scores`))).rejects.toThrow();
    await teacher.classroom.setStatus(room.id, 'running');
    const { id, correct, wrong } = question(first.player);
    await Promise.all([student.classroom.submitAnswer(room.id, id, correct), student.classroom.submitAnswer(room.id, id, correct)]);
    let resumed = await student.classroom.joinRoom(room.code, '其他暱稱');
    expect(resumed.player.nickname).toBe(first.player.nickname);
    expect(resumed.player.order).toEqual(first.player.order);
    expect(resumed.player.completedCount).toBe(1);
    expect(resumed.player.totalScore).toBe(0);
    expect(resumed.player.pendingId).toBe(id);
    await expect(student.classroom.submitAnswer(room.id, id, wrong)).rejects.toThrow();
    await expect(student.classroom.submitAnswer(room.id, question(first.player, 1).id, 0)).rejects.toThrow();
    await Promise.all([student.classroom.openChest(room.id, id, 0), student.classroom.openChest(room.id, id, 2)]);
    const opened = await readAnswer(student, room.id, id);
    expect(opened.chest?.settled).toBe(false);
    expect(opened.points).toBe(0);
    await student.classroom.openChest(room.id, id, 1);
    expect((await readAnswer(student, room.id, id)).chest).toEqual(opened.chest);
    await env.withSecurityRulesDisabled(async context => {
      await context.firestore().doc(`rooms/${room.id}/players/${student.uid}/answers/${id}`).update({ 'chest.outcome': { kind: 'gain', amount: 50 } });
    });
    await Promise.all([student.classroom.claimChest(room.id, id), student.classroom.claimChest(room.id, id)]);
    resumed = await student.classroom.joinRoom(room.code, '小明');
    expect(resumed.player.totalScore).toBe(50);
    expect(resumed.player.revision).toBe(3);
    expect(resumed.player.pendingId).toBeNull();
    expect((await readAnswer(student, room.id, id)).chest).toMatchObject({ settled: true, delta: 50, fallback: false });
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => { stop(); reject(new Error('Progress listener timeout')); }, 5000);
      const stop = student.classroom.watchProgress(room.id, (player, answers) => {
        if (player.totalScore === 50 && answers[id]?.chest?.settled) {
          clearTimeout(timeout); stop(); resolve();
        }
      }, error => { clearTimeout(timeout); stop(); reject(error); });
    });
    await teacher.classroom.publishLeaderboard(room.id, await teacher.classroom.getPlayers(room.id));
    const publicPage = (await getDocFromServer(doc(student.db, `rooms/${room.id}/public/leaderboard`))).data();
    expect(publicPage?.entries).toEqual([{ nickname: first.player.nickname, score: 50 }, { nickname: second.player.nickname, score: 0 }]);
    expect(publicPage?.entries[0]).not.toHaveProperty('uid');
    await teacher.classroom.setStatus(room.id, 'ended');
    await expect(student.classroom.submitAnswer(room.id, question(first.player, 1).id, 0)).rejects.toThrow();
    await expect(stranger.classroom.joinRoom(room.code, '新人')).rejects.toThrow();
    expect((await getDocFromServer(doc(student.db, `rooms/${room.id}/public/leaderboard`))).data()?.entries[0]?.score).toBe(50);
    await teacher.classroom.setStatus(room.id, 'archived');
    expect((await student.classroom.resumeRoom(room.code))?.room.status).toBe('archived');
  });

  it('publishes the updated score with the first settled chest snapshot', async () => {
    const { teacher, room, students } = await fixture(1);
    const student = students[0]!;
    await teacher.classroom.setStatus(room.id, 'running');
    const id = await prepareChest(room.id, student, { kind: 'gain', amount: 50 });
    let signalReady = () => {};
    let signalSettled = (_score: number) => {};
    let reportError = (_error: unknown) => {};
    const ready = new Promise<void>(resolve => { signalReady = resolve; });
    const settled = new Promise<number>((resolve, reject) => {
      signalSettled = resolve;
      reportError = reject;
    });
    const stop = student.actor.classroom.watchProgress(room.id, (player, answers) => {
      const chest = answers[id]?.chest;
      if (chest?.settled) signalSettled(player.totalScore);
      else if (chest?.outcome.kind === 'gain' && chest.outcome.amount === 50) signalReady();
    }, reportError);
    try {
      await ready;
      await student.actor.classroom.claimChest(room.id, id);
      expect(await settled).toBe(50);
    } finally {
      stop();
    }
  });

  it.each(['steal', 'swap'] as const)('settles concurrent %s transactions atomically using current target scores', async kind => {
    const { teacher, room, students } = await fixture(3);
    const first = students[0]!, second = students[1]!, target = students[2]!;
    await teacher.classroom.setStatus(room.id, 'running');
    const values = kind === 'steal' ? [100, 100, 150] : [10, 20, 30];
    await seedScores(room.id, students, values);
    const firstId = await prepareChest(room.id, first, { kind, amount: 0 });
    const secondId = await prepareChest(room.id, second, { kind, amount: 0 });
    const targetBefore = (await getDocFromServer(doc(target.actor.db, `rooms/${room.id}/players/${target.actor.uid}`))).data();
    await Promise.all([
      first.actor.classroom.claimChest(room.id, firstId, target.actor.uid),
      second.actor.classroom.claimChest(room.id, secondId, target.actor.uid),
    ]);
    const scores = await publicScores(first.actor, room.id);
    expect([...scores.values()].reduce((sum, value) => sum + value, 0)).toBe(values.reduce((sum, value) => sum + value, 0));
    if (kind === 'steal') {
      expect(scores.get(target.actor.uid)).toBe(0);
      expect([scores.get(first.actor.uid), scores.get(second.actor.uid)].sort()).toEqual([150, 200]);
    } else {
      expect([...scores.values()].sort((a, b) => a - b)).toEqual([10, 20, 30]);
      expect(scores.get(target.actor.uid)).not.toBe(30);
    }
    expect((await getDocFromServer(doc(target.actor.db, `rooms/${room.id}/players/${target.actor.uid}`))).data()).toEqual(targetBefore);
    await first.actor.classroom.claimChest(room.id, firstId, target.actor.uid);
    expect(await publicScores(first.actor, room.id)).toEqual(scores);
    await expect(first.actor.classroom.claimChest(room.id, firstId, second.actor.uid)).rejects.toThrow();
  });

  it('requires another same-room target and retains the pending chest after invalid targets', async () => {
    const { teacher, room, students } = await fixture();
    const first = students[0]!, second = students[1]!;
    const outside = await fixture(1);
    await teacher.classroom.setStatus(room.id, 'running');
    const id = await prepareChest(room.id, first, { kind: 'steal', amount: 0 });
    for (const target of [null, first.actor.uid, outside.students[0]!.actor.uid]) {
      await expect(first.actor.classroom.claimChest(room.id, id, target)).rejects.toThrow();
    }
    expect((await readAnswer(first.actor, room.id, id)).chest?.settled).toBe(false);
    await first.actor.classroom.claimChest(room.id, id, second.actor.uid);
    expect((await readAnswer(first.actor, room.id, id)).chest).toMatchObject({ settled: true, delta: 0, fallback: false });
  });

  it.each(['steal', 'swap'] as const)('gives a solo %s exactly 20 points once', async kind => {
    const { teacher, room, students } = await fixture(1);
    const student = students[0]!;
    await teacher.classroom.setStatus(room.id, 'running');
    const id = await prepareChest(room.id, student, { kind, amount: 0 });
    await Promise.all([student.actor.classroom.claimChest(room.id, id), student.actor.classroom.claimChest(room.id, id)]);
    expect((await publicScores(student.actor, room.id)).get(student.actor.uid)).toBe(20);
    expect((await readAnswer(student.actor, room.id, id)).chest).toMatchObject({ fallback: true, delta: 20, targetId: null });
  });

  it('clamps losses at zero and preserves configured duration across pause/resume', async () => {
    const { teacher, room, students } = await fixture(1);
    const student = students[0]!;
    await teacher.classroom.setDuration(room.id, 3);
    await teacher.classroom.setStatus(room.id, 'running');
    await expect(teacher.classroom.setDuration(room.id, 4)).rejects.toThrow();
    await seedScores(room.id, students, [10]);
    const id = await prepareChest(room.id, student, { kind: 'loss', amount: 30 });
    await teacher.classroom.setStatus(room.id, 'paused');
    await expect(student.actor.classroom.claimChest(room.id, id)).rejects.toThrow();
    const pausedSnapshot = await getDocFromServer(doc(student.actor.db, `rooms/${room.id}`));
    const paused = parseRoom(room.id, pausedSnapshot.data());
    expect(paused.durationMinutes).toBe(3);
    expect(paused.remainingMs).toBeGreaterThan(0);
    expect(paused.remainingMs).toBeLessThan(180000);
    expect(paused.runningSince).toBeNull();
    await new Promise(resolve => setTimeout(resolve, 100));
    expect((await student.actor.classroom.resumeRoom(room.code))?.room.remainingMs).toBe(paused.remainingMs);
    await teacher.classroom.setStatus(room.id, 'running');
    const resumed = (await student.actor.classroom.resumeRoom(room.code))!.room;
    expect(resumed.remainingMs).toBe(paused.remainingMs);
    expect(resumed.runningSince).not.toBeNull();
    await student.actor.classroom.claimChest(room.id, id);
    expect((await publicScores(student.actor, room.id)).get(student.actor.uid)).toBe(0);
    expect((await readAnswer(student.actor, room.id, id)).chest?.delta).toBe(-10);
  });

  it('rejects every new reward/progress mutation after the server deadline and allows final closure', async () => {
    const { teacher, room, students } = await fixture(3);
    const answered = students[0]!, opened = students[1]!, untouched = students[2]!;
    await teacher.classroom.setStatus(room.id, 'running');
    const pending = question(answered.player);
    await answered.actor.classroom.submitAnswer(room.id, pending.id, pending.correct);
    const openedId = await prepareChest(room.id, opened, { kind: 'gain', amount: 80 });
    await env.withSecurityRulesDisabled(async context => {
      await context.firestore().doc(`rooms/${room.id}`).update({ remainingMs: 1, runningSince: Timestamp.fromMillis(Date.now() - 10000) });
    });
    const next = question(untouched.player);
    await expect(untouched.actor.classroom.submitAnswer(room.id, next.id, next.correct)).rejects.toThrow();
    await expect(answered.actor.classroom.openChest(room.id, pending.id, 0)).rejects.toThrow();
    await expect(opened.actor.classroom.claimChest(room.id, openedId)).rejects.toThrow();
    await expect(teacher.classroom.setStatus(room.id, 'paused')).rejects.toThrow();
    expect([...await publicScores(untouched.actor, room.id)].every(([, score]) => score === 0)).toBe(true);
    await teacher.classroom.setStatus(room.id, 'ended');
    await expect(teacher.classroom.setStatus(room.id, 'running')).rejects.toThrow();
    expect((await getDocFromServer(doc(teacher.db, `rooms/${room.id}/public/leaderboard`))).data()?.entries).toHaveLength(3);
  });
  it('coordinates concurrent publishers and prevents stale periodic writes after closing', async () => {
    const teacher = await client(true), student = await client();
    const room = await teacher.classroom.createRoom();
    const { player } = await student.classroom.joinRoom(room.code, '排名同學');
    const low = [{ ...player, totalScore: 100 }], high = [{ ...player, totalScore: 200 }];
    const attempts = await Promise.all([
      teacher.classroom.publishLeaderboard(room.id, low),
      new Classroom(teacher.db, teacher.user).publishLeaderboard(room.id, high),
    ]);
    expect(attempts.filter(Boolean)).toHaveLength(1);
    const reference = doc(teacher.db, `rooms/${room.id}/public/leaderboard`);
    const first = (await getDocFromServer(reference)).data();
    const winning = first?.entries[0]?.score === 100 ? low : high;
    await teacher.classroom.publishLeaderboard(room.id, winning);
    expect((await getDocFromServer(reference)).data()?.updatedAt.isEqual(first?.updatedAt)).toBe(true);
    await teacher.classroom.setStatus(room.id, 'ended');
    expect((await getDocFromServer(reference)).data()?.entries).toEqual([{ nickname: '排名同學', score: 0 }]);
    expect(await teacher.classroom.publishLeaderboard(room.id, high)).toBe(false);
    expect((await getDocFromServer(reference)).data()?.entries[0]?.score).toBe(0);
  });
  it('keeps a final wrong answer unfinished until its three-second freeze expires across reconnect', async () => {
    const { teacher, room, students } = await fixture(1);
    const student = students[0]!;
    await teacher.classroom.setStatus(room.id, 'running');
    await env.withSecurityRulesDisabled(async context => {
      await context.firestore().doc(`rooms/${room.id}/players/${student.actor.uid}`).update({ completedCount: 39, revision: 39 });
    });
    const { id, wrong } = question(student.player, 39);
    await student.actor.classroom.submitAnswer(room.id, id, wrong);
    let recovered = (await student.actor.classroom.resumeRoom(room.code))!.player;
    expect(recovered.completedCount).toBe(40);
    expect(recovered.totalScore).toBe(0);
    expect(recovered.finishedAt).toBeNull();
    expect(recovered.cooldownUntil).toBeGreaterThan(Date.now());
    await expect(student.actor.classroom.finishPlayer(room.id)).rejects.toThrow();
    await expect(student.actor.classroom.openChest(room.id, id, 0)).rejects.toThrow();
    await new Promise(resolve => setTimeout(resolve, Math.max(0, (recovered.cooldownUntil ?? 0) - Date.now()) + 150));
    await Promise.all([student.actor.classroom.finishPlayer(room.id), student.actor.classroom.finishPlayer(room.id)]);
    recovered = (await student.actor.classroom.resumeRoom(room.code))!.player;
    expect(recovered.finishedAt).not.toBeNull();
    expect(recovered.revision).toBe(41);
    expect(recovered.totalScore).toBe(0);
    const saved = (await getDocFromServer(doc(student.actor.db, `rooms/${room.id}/players/${student.actor.uid}`))).data();
    expect(saved).not.toHaveProperty('score');
  });

  it('finishes a final correct answer only when its chest is settled', async () => {
    const { teacher, room, students } = await fixture(1);
    const student = students[0]!;
    await teacher.classroom.setStatus(room.id, 'running');
    await env.withSecurityRulesDisabled(async context => {
      await context.firestore().doc(`rooms/${room.id}/players/${student.actor.uid}`).update({ completedCount: 39, revision: 39 });
    });
    const id = await prepareChest(room.id, student, { kind: 'gain', amount: 80 }, 39);
    expect((await student.actor.classroom.resumeRoom(room.code))?.player.finishedAt).toBeNull();
    await student.actor.classroom.claimChest(room.id, id);
    const recovered = (await student.actor.classroom.resumeRoom(room.code))!.player;
    expect(recovered.completedCount).toBe(40);
    expect(recovered.finishedAt).not.toBeNull();
    expect(recovered.totalScore).toBe(80);
    expect(recovered.revision).toBe(42);
  });
});

describe('resumable room deletion with the real SDK', () => {
  it('drains multiple batches and legacy child data, protects another room and confirms repeated completion', async () => {
    const { teacher, room, students } = await fixture(1);
    const other = await teacher.classroom.createRoom();
    const uid = students[0]!.actor.uid;
    await env.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      const batch = db.batch();
      for (let i = 0; i < 45; i++) batch.set(db.doc(`rooms/${room.id}/players/${uid}/events/${i}`), { old: true });
      batch.set(db.doc(`rooms/${room.id}/scores/orphan`), { malformed: true });
      batch.set(db.doc(`rooms/${room.id}/players/${uid}/answers/old`), { malformed: true });
      await batch.commit();
    });
    await teacher.classroom.beginDeletion(room.id, room.code);
    expect((await getDocFromServer(doc(teacher.db, `rooms/${room.id}`))).data()?.status).toBe('deleting');
    await expect(students[0]!.actor.classroom.joinRoom(room.code, '小明')).rejects.toThrow();
    await teacher.classroom.deleteRoom(room.id, room.code);
    await teacher.classroom.deleteRoom(room.id, room.code);
    expect((await getDocFromServer(doc(teacher.db, `retiredRoomCodes/${room.code}`))).data()?.state).toBe('completed');
    await env.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      expect((await db.doc(`rooms/${room.id}`).get()).exists).toBe(false);
      for (const path of ['players', 'scores', 'public', `players/${uid}/events`, `players/${uid}/answers`]) expect((await db.collection(`rooms/${room.id}/${path}`).get()).empty).toBe(true);
      expect((await db.doc(`roomCodes/${room.code}`).get()).exists).toBe(false);
      expect((await db.doc(`rooms/${other.id}`).get()).exists).toBe(true);
    });
  });
  it('cleans a legacy running room with missing index and rejects a mismatched index', async () => {
    const { teacher, room } = await fixture(0);
    const other = await teacher.classroom.createRoom();
    await env.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      const original = (await db.doc(`rooms/${room.id}`).get()).data();
      if (!original) throw new Error('Missing fixture');
      delete original.rulesVersion;
      await db.doc(`rooms/${room.id}`).set({ ...original, status: 'running' });
      await db.doc(`roomCodes/${room.code}`).set({ roomId: other.id, ownerUid: teacher.uid });
    });
    await expect(teacher.classroom.beginDeletion(room.id, room.code)).rejects.toThrow('索引不一致');
    await env.withSecurityRulesDisabled(context => context.firestore().doc(`roomCodes/${room.code}`).delete());
    await teacher.classroom.deleteRoom(room.id, room.code);
    expect((await getDocFromServer(doc(teacher.db, `rooms/${other.id}`))).exists()).toBe(true);
    expect((await getDocFromServer(doc(teacher.db, `retiredRoomCodes/${room.code}`))).data()?.state).toBe('completed');
  });
  it('rejects active rooms and converges concurrent cleanup after authorization is restored', async () => {
    const { teacher, room } = await fixture(0);
    await teacher.classroom.setStatus(room.id, 'running');
    await expect(teacher.classroom.beginDeletion(room.id, room.code)).rejects.toThrow();
    await teacher.classroom.setStatus(room.id, 'paused');
    await expect(teacher.classroom.beginDeletion(room.id, room.code)).rejects.toThrow();
    await teacher.classroom.setStatus(room.id, 'ended');
    await teacher.classroom.beginDeletion(room.id, room.code);
    await env.withSecurityRulesDisabled(context => context.firestore().doc('teacherEmails/teacher@example.test').set({ authorized: false }));
    await expect(teacher.classroom.deleteRoom(room.id, room.code)).rejects.toThrow();
    await env.withSecurityRulesDisabled(context => context.firestore().doc('teacherEmails/teacher@example.test').set({ authorized: true }));
    await Promise.all([teacher.classroom.deleteRoom(room.id, room.code), teacher.classroom.deleteRoom(room.id, room.code)]);
  });
});
