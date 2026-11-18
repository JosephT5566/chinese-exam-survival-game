import { readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { initializeApp, deleteApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInAnonymously, signInWithCredential, GoogleAuthProvider } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore, getDocFromServer, doc, collection, getDocsFromServer, terminate } from 'firebase/firestore';
import { Classroom } from '../../src/firebase/classroom';
import { questionSetVersion } from '../../src/firebase/model';
import { questions } from '../../src/questions/bank';

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
  return { db, uid: result.user.uid, classroom: new Classroom(db, result.user.uid) };
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
  it('admin authorization is dry-run by default, rejects missing users, and applies idempotently', async () => {
    const teacher = await client(true, 'provision@example.test');
    const args = ['scripts/authorize-teachers.mjs', '--emulator', '--project', project, '--email', 'provision@example.test'];
    const run = promisify(execFile);
    await run(process.execPath, args);
    expect(await teacher.classroom.isTeacher()).toBe(false);
    await run(process.execPath, [...args, '--apply']);
    expect(await teacher.classroom.isTeacher()).toBe(true);
    await run(process.execPath, [...args, '--apply']);
    expect(await teacher.classroom.isTeacher()).toBe(true);
    await expect(run(process.execPath, [...args.slice(0, -1), 'missing@example.test'])).rejects.toMatchObject({ code: 2 });
  });
  it('runs join, concurrent answer/explanation, recovery, ranking and lifecycle without private leaks', async () => {
    const teacher = await client(true), student = await client(), other = await client();
    await expect(teacher.classroom.createRoom()).rejects.toThrow();
    await env.withSecurityRulesDisabled(async context => {
      await context.firestore().doc(`teachers/${teacher.uid}`).set({ authorized: true });
    });
    const room = await teacher.classroom.createRoom();
    expect(room.status).toBe('lobby');
    expect(room.questionSetVersion).toBe(questionSetVersion);
    const joined = await student.classroom.joinRoom(room.code, '小明');
    expect(joined.room.id).toBe(room.id);
    expect(joined.player.completedCount).toBe(0);
    await other.classroom.joinRoom(room.code, '小華');
    expect(await (await client()).classroom.resumeRoom(room.code)).toBeNull();
    await expect(getDocFromServer(doc(other.db, `rooms/${room.id}/players/${student.uid}`))).rejects.toThrow();
    await expect(getDocsFromServer(collection(student.db, `rooms/${room.id}/players`))).rejects.toThrow();
    await teacher.classroom.setStatus(room.id, 'running');
    const id = joined.player.order[0]!;
    const correct = joined.player.choices[id]!.indexOf(questions.get(id)!.correctChoiceIndex);
    const wrong = (correct + 1) % 4;
    await Promise.all([student.classroom.submitAnswer(room.id, id, wrong), student.classroom.submitAnswer(room.id, id, wrong)]);
    let saved = (await getDocFromServer(doc(student.db, `rooms/${room.id}/players/${student.uid}`))).data();
    expect(saved?.completedCount).toBe(1); expect(saved?.score).toBe(0);
    expect((await getDocsFromServer(collection(student.db, `rooms/${room.id}/players/${student.uid}/answers`))).size).toBe(1);
    await Promise.all([student.classroom.claimExplanation(room.id, id), student.classroom.claimExplanation(room.id, id)]);
    saved = (await getDocFromServer(doc(student.db, `rooms/${room.id}/players/${student.uid}`))).data();
    expect(saved?.score).toBe(20); expect(saved?.revision).toBe(2);
    const resumed = await student.classroom.joinRoom(room.code, '別的暱稱');
    expect(resumed.player.nickname).toBe('小明'); expect(resumed.player.order).toEqual(joined.player.order);
    expect(resumed.player.totalScore).toBe(20);
    await expect(student.classroom.submitAnswer(room.id, id, correct)).rejects.toThrow();
    const roster = await teacher.classroom.getPlayers(room.id);
    await teacher.classroom.publishLeaderboard(room.id, roster);
    const publicPage = (await getDocFromServer(doc(student.db, `rooms/${room.id}/public/leaderboard`))).data();
    expect(publicPage?.entries).toEqual([{ nickname: '小明', score: 20 }, { nickname: '小華', score: 0 }]);
    expect(publicPage?.entries[0]).not.toHaveProperty('uid');
    const nextId = joined.player.order[1]!;
    await teacher.classroom.setStatus(room.id, 'paused');
    await expect(student.classroom.submitAnswer(room.id, nextId, 0)).rejects.toThrow();
    await teacher.classroom.setStatus(room.id, 'running');
    await student.classroom.submitAnswer(room.id, nextId, joined.player.choices[nextId]!.indexOf(questions.get(nextId)!.correctChoiceIndex));
    expect((await student.classroom.joinRoom(room.code, '小明')).player.totalScore).toBe(120);
    expect(await teacher.classroom.publishLeaderboard(room.id, await teacher.classroom.getPlayers(room.id))).toBe(false);
    await teacher.classroom.setStatus(room.id, 'ended');
    expect((await getDocFromServer(doc(student.db, `rooms/${room.id}/public/leaderboard`))).data()?.entries[0]?.score).toBe(120);
    await expect(student.classroom.submitAnswer(room.id, joined.player.order[2]!, 0)).rejects.toThrow();
    const newcomer = await client();
    await expect(newcomer.classroom.joinRoom(room.code, '新人')).rejects.toThrow();
    await teacher.classroom.setStatus(room.id, 'archived');
    expect((await student.classroom.joinRoom(room.code, '小明')).room.status).toBe('archived');
  });
  it('coordinates concurrent publishers and prevents stale periodic writes after closing', async () => {
    const teacher = await client(true), student = await client();
    const room = await teacher.classroom.createRoom();
    const { player } = await student.classroom.joinRoom(room.code, '排名同學');
    const low = [{ ...player, totalScore: 100 }], high = [{ ...player, totalScore: 200 }];
    const attempts = await Promise.all([
      teacher.classroom.publishLeaderboard(room.id, low),
      new Classroom(teacher.db, teacher.uid).publishLeaderboard(room.id, high),
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
  it('preserves the 40th incorrect answer for explanation credit after reconnect', async () => {
    const teacher = await client(true), student = await client();
    const room = await teacher.classroom.createRoom();
    const joined = await student.classroom.joinRoom(room.code, '最後一題');
    await teacher.classroom.setStatus(room.id, 'running');
    await env.withSecurityRulesDisabled(async context => {
      await context.firestore().doc(`rooms/${room.id}/players/${student.uid}`).update({ completedCount: 39, score: 3900, revision: 39 });
    });
    const id = joined.player.order[39]!;
    const correct = joined.player.choices[id]!.indexOf(questions.get(id)!.correctChoiceIndex);
    await student.classroom.submitAnswer(room.id, id, (correct + 1) % 4);
    expect((await student.classroom.joinRoom(room.code, '最後一題')).player.completedCount).toBe(40);
    await student.classroom.claimExplanation(room.id, id);
    const saved = (await getDocFromServer(doc(student.db, `rooms/${room.id}/players/${student.uid}`))).data();
    expect(saved?.score).toBe(3920); expect(saved?.finishedAt).not.toBeNull();
  });
});
