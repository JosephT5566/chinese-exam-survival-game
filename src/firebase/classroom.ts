import { FirebaseError } from 'firebase/app';
import type { User } from 'firebase/auth';
import {
  collection, doc, getDocFromServer, getDocsFromServer, onSnapshot, query, where,
  runTransaction, serverTimestamp, writeBatch, type Firestore,
} from 'firebase/firestore';
import { newPlayer } from '../game/session';
import { drawChest, remainingTime, resolveScores } from '../game/rewards';
import { questions } from '../questions/bank';
import {
  LeaderboardBuffer, object, parseAnswer, parsePlayer, parseRoom, parseScore, questionSetVersion, rankedPlayers,
  type CloudAnswer, type CloudPlayer, type CloudRoom, type Leaderboard, type RoomStatus, type PublicScore,
} from './model';

const online = () => {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('目前離線，請連線後再送出。');
};
export function cloudError(error: unknown): string {
  if (error instanceof FirebaseError) {
    if (error.code.includes('permission-denied')) return '沒有操作權限，或房間狀態已變更。請確認老師授權及活動狀態。';
    if (error.code.includes('unavailable')) return '暫時無法連線，請確認網路後重試。';
    if (error.code === 'auth/popup-closed-by-user' || error.code === 'auth/cancelled-popup-request') return '登入已取消，可重新登入。';
    if (error.code === 'auth/popup-blocked') return '瀏覽器阻擋登入視窗，請允許彈出視窗後重試。';
    return '無法完成操作，請稍後重試。';
  }
  return error instanceof Error ? error.message : '無法完成操作，請稍後重試。';
}
export class Classroom {
  readonly uid: string;
  private readonly teacherEmail: string | null;
  constructor(readonly db: Firestore, identity: Pick<User, 'uid' | 'email'>) {
    this.uid = identity.uid;
    this.teacherEmail = identity.email?.toLowerCase() ?? null;
  }
  async isTeacher(): Promise<boolean> {
    if (!this.teacherEmail) return false;
    try { return (await getDocFromServer(doc(this.db, 'teacherEmails', this.teacherEmail))).data()?.authorized === true; }
    catch (error) {
      if (error instanceof FirebaseError && error.code === 'permission-denied') return false;
      throw error;
    }
  }
  async createRoom(durationMinutes = 20): Promise<CloudRoom> {
    this.validDuration(durationMinutes);
    online();
    if (!await this.isTeacher()) throw new Error('帳號尚未獲得老師授權。');
    for (let attempt = 0; attempt < 5; attempt++) {
      const bytes = crypto.getRandomValues(new Uint8Array(6));
      const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      const code = [...bytes].map(n => alphabet[n % alphabet.length]).join('');
      const reference = doc(collection(this.db, 'rooms'));
      const room: CloudRoom = { id: reference.id, code, ownerUid: this.uid, status: 'lobby', questionSetVersion, rulesVersion: 2, durationMinutes, remainingMs: durationMinutes * 60000, runningSince: null, playerCount: 0 };
      if ((await getDocFromServer(doc(this.db, 'roomCodes', code))).exists()) continue;
      const batch = writeBatch(this.db);
      batch.set(reference, { code, ownerUid: this.uid, status: 'lobby', questionSetVersion,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(), startedAt: null, endedAt: null, rulesVersion: 2, durationMinutes, remainingMs: durationMinutes * 60000, runningSince: null, pausedAt: null, playerCount: 0 });
      batch.set(doc(this.db, 'roomCodes', code), { roomId: reference.id, ownerUid: this.uid });
      try { await batch.commit(); return room; }
      catch (error) {
        if (!(error instanceof FirebaseError) || error.code !== 'permission-denied'
          || !(await getDocFromServer(doc(this.db, 'roomCodes', code))).exists()) throw error;
      }
    }
    throw new Error('暫時無法產生房間碼，請重試。');
  }
  async resumeRoom(code: string) {
    const index = (await getDocFromServer(doc(this.db, 'roomCodes', code))).data();
    if (!object(index) || typeof index.roomId !== 'string') return null;
    const roomId = index.roomId;
    try {
      const player = await getDocFromServer(doc(this.db, 'rooms', roomId, 'players', this.uid));
      if (!player.exists()) return null;
      const room = await getDocFromServer(doc(this.db, 'rooms', roomId));
      return { room: parseRoom(roomId, room.data()), player: await this.readPlayer(roomId, player.data()) };
    } catch (error) {
      if (error instanceof FirebaseError && error.code === 'permission-denied') return null;
      throw error;
    }
  }
  async joinRoom(rawCode: string, rawNickname: string) {
    online();
    const code = rawCode.trim().toUpperCase(), nickname = rawNickname.trim();
    if (!/^[A-Z0-9]{6}$/.test(code)) throw new Error('請輸入六位英數房間碼。');
    if (nickname.length < 2 || nickname.length > 12) throw new Error('暱稱請輸入 2 至 12 個字。');
    const index = (await getDocFromServer(doc(this.db, 'roomCodes', code))).data();
    if (!object(index) || typeof index.roomId !== 'string') throw new Error('找不到房間，請核對房間碼。');
    const roomId = index.roomId, reference = doc(this.db, 'rooms', roomId, 'players', this.uid);
    let existing = false;
    try { existing = (await getDocFromServer(reference)).exists(); }
    catch (error) {
      // Before membership exists, rules deliberately deny this get.
      if (!(error instanceof FirebaseError) || error.code !== 'permission-denied') throw error;
    }
    if (!existing) {
      const player = newPlayer(nickname);
      await runTransaction(this.db, async transaction => {
        const roomRef = doc(this.db, 'rooms', roomId);
        const roomDoc = await transaction.get(roomRef);
        const room = parseRoom(roomId, roomDoc.data());
        this.modernRoom(room);
        if (room.status !== 'lobby' || room.playerCount >= 30) throw new Error('房間已停止加入或已滿 30 人。');
        transaction.set(reference, { nickname, joinedAt: serverTimestamp(), questionOrder: player.order,
          choiceOrders: player.choices, completedCount: 0, revision: 0,
          lastOperation: null, finishedAt: null, cooldownStartedAt: null, pendingId: null });
        transaction.set(doc(this.db, 'rooms', roomId, 'scores', this.uid), { nickname, score: 0, lastOperation: null });
        transaction.update(roomRef, { playerCount: room.playerCount + 1 });
      }).catch(async error => {
        const saved = await getDocFromServer(reference).catch(() => null);
        if (!saved?.exists()) throw error;
      });
    }
    const [room, player] = await Promise.all([
      getDocFromServer(doc(this.db, 'rooms', roomId)), getDocFromServer(reference),
    ]);
    return { room: parseRoom(roomId, room.data()), player: await this.readPlayer(roomId, player.data()) };
  }
  private modernRoom(room: CloudRoom) {
    if (room.rulesVersion !== 2) throw new Error('這是舊規則教室，僅供回顧；請老師建立新教室。');
  }
  private validDuration(minutes: number) {
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 60) throw new Error('請輸入 1 至 60 的整數分鐘。');
  }
  private playing(room: CloudRoom) {
    this.modernRoom(room);
    if (room.status !== 'running' || remainingTime(room) <= 0) throw new Error('活動已暫停、結束或時間已到。');
  }
  private async readPlayer(roomId: string, data: unknown) {
    if (object(data) && 'score' in data) return parsePlayer(this.uid, data);
    const score = await getDocFromServer(doc(this.db, 'rooms', roomId, 'scores', this.uid));
    return parsePlayer(this.uid, data, parseScore(this.uid, score.data()));
  }
  async setDuration(roomId: string, minutes: number) {
    this.validDuration(minutes);
    const reference = doc(this.db, 'rooms', roomId);
    await runTransaction(this.db, async transaction => {
      const room = parseRoom(roomId, (await transaction.get(reference)).data());
      this.modernRoom(room);
      if (room.status !== 'lobby') throw new Error('開始後不能修改總時間。');
      transaction.update(reference, { durationMinutes: minutes, remainingMs: minutes * 60_000, updatedAt: serverTimestamp() });
    });
  }
  async setStatus(roomId: string, next: RoomStatus) {
    online();
    const reference = doc(this.db, 'rooms', roomId);
    await runTransaction(this.db, async transaction => {
      const room = parseRoom(roomId, (await transaction.get(reference)).data());
      this.modernRoom(room);
      if (room.status === next) return;
      if ((next === 'running' && room.status !== 'lobby') || next === 'paused') {
        if (remainingTime(room) <= 0) throw new Error('時間已到，請結束活動。');
      }
      transaction.update(reference, { status: next, updatedAt: serverTimestamp(),
        ...(room.status === 'lobby' && next === 'running' ? { startedAt: serverTimestamp() } : {}),
        ...(next === 'running' ? { remainingMs: room.remainingMs, runningSince: serverTimestamp(), pausedAt: null } : {}),
        ...(next === 'paused' ? { pausedAt: serverTimestamp() } : {}),
        ...(next === 'ended' ? { endedAt: serverTimestamp(), remainingMs: 0, runningSince: null, pausedAt: null } : {}) });
    });
    // Closing freezes scores. Flush final ranks even when the periodic publisher
    // has not reached its next 10-second tick yet.
    if (next === 'ended' || next === 'archived') await this.publishLeaderboard(roomId, await this.getPlayers(roomId), 'final');
  }
  async submitAnswer(roomId: string, questionId: string, selected: number) {
    online();
    if (!Number.isInteger(selected) || selected < 0 || selected > 3) throw new Error('請選擇答案。');
    const playerRef = doc(this.db, 'rooms', roomId, 'players', this.uid);
    const answerRef = doc(collection(playerRef, 'answers'), questionId);
    await runTransaction(this.db, async transaction => {
      const [playerDoc, answerDoc, roomDoc] = await Promise.all([
        transaction.get(playerRef), transaction.get(answerRef), transaction.get(doc(this.db, 'rooms', roomId)),
      ]);
      const player = parsePlayer(this.uid, playerDoc.data());
      if (answerDoc.exists()) {
        if (parseAnswer(answerDoc.data()).selected !== selected) throw new Error('此題已保存其他答案，請重新載入進度。');
        return;
      }
      this.playing(parseRoom(roomId, roomDoc.data()));
      if (player.pendingId || (player.cooldownUntil ?? 0) > Date.now()) throw new Error('請先完成寶箱或等待冷凍結束。');
      const question = questions.get(questionId);
      if (!question || player.order[player.completedCount] !== questionId) throw new Error('題目進度已更新，請重新載入。');
      const isCorrect = player.choices[questionId]?.[selected] === question.correctChoiceIndex;
      transaction.set(answerRef, { ordinal: player.completedCount + 1, selectedChoice: selected, isCorrect,
        explanationViewed: false, awardedPoints: 0, answeredAt: serverTimestamp(), explanationViewedAt: null, chest: null });
      transaction.update(playerRef, { completedCount: player.completedCount + 1,
        revision: player.revision + 1, lastOperation: { kind: 'answer', id: questionId },
        cooldownStartedAt: isCorrect ? null : serverTimestamp(), pendingId: isCorrect ? questionId : null, finishedAt: null });
    }).catch(async error => {
      // Rules can reject a stale concurrent commit before Firestore retries it.
      // Reconcile the immutable answer; never replay an increment blindly.
      const saved = await getDocFromServer(answerRef).catch(() => null);
      if (saved?.exists() && parseAnswer(saved.data()).selected === selected) return;
      throw error;
    });
  }
  async openChest(roomId: string, questionId: string, box: number) {
    online();
    if (!Number.isInteger(box) || box < 0 || box > 2) throw new Error('請選擇三個寶箱之一。');
    const outcome = drawChest();
    const playerRef = doc(this.db, 'rooms', roomId, 'players', this.uid);
    const answerRef = doc(collection(playerRef, 'answers'), questionId);
    await runTransaction(this.db, async transaction => {
      const [p, a, r] = await Promise.all([transaction.get(playerRef), transaction.get(answerRef), transaction.get(doc(this.db, 'rooms', roomId))]);
      const answer = parseAnswer(a.data()), player = parsePlayer(this.uid, p.data());
      if (answer.chest) return;
      this.playing(parseRoom(roomId, r.data()));
      if (!answer.correct || player.pendingId !== questionId) throw new Error('此題沒有可開啟的寶箱。');
      transaction.update(answerRef, { chest: { box, outcome, targetId: null, settled: false, delta: 0, fallback: false } });
      transaction.update(playerRef, { revision: player.revision + 1, lastOperation: { kind: 'open', id: questionId } });
    }).catch(async error => {
      const saved = await getDocFromServer(answerRef).catch(() => null);
      if (!saved?.exists() || !parseAnswer(saved.data()).chest) throw error;
    });
  }
  async claimChest(roomId: string, questionId: string, targetId: string | null = null) {
    online();
    const playerRef = doc(this.db, 'rooms', roomId, 'players', this.uid);
    const answerRef = doc(collection(playerRef, 'answers'), questionId);
    const scoreRef = doc(this.db, 'rooms', roomId, 'scores', this.uid);
    // Rules may reject a stale peer score before the SDK retries contention.
    // Re-read both balances in a new transaction; never replay an increment.
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await runTransaction(this.db, async transaction => {
          const [p, a, r, s] = await Promise.all([transaction.get(playerRef), transaction.get(answerRef),
            transaction.get(doc(this.db, 'rooms', roomId)), transaction.get(scoreRef)]);
          const player = parsePlayer(this.uid, p.data()), answer = parseAnswer(a.data()), room = parseRoom(roomId, r.data());
          const chest = answer.chest;
          if (!chest) throw new Error('請先選擇寶箱。');
          if (chest.settled) {
            if (chest.targetId !== targetId) throw new Error('此寶箱已套用至其他目標。');
            return;
          }
          this.playing(room);
          if (player.pendingId !== questionId) throw new Error('寶箱進度已更新。');
          const needsTarget = chest.outcome.kind === 'steal' || chest.outcome.kind === 'swap';
          if (targetId === this.uid || (targetId && !needsTarget)) throw new Error('請選擇同房的其他玩家。');
          if (needsTarget && room.playerCount > 1 && !targetId) throw new Error('請選擇同房的其他玩家。');
          const targetRef = targetId ? doc(this.db, 'rooms', roomId, 'scores', targetId) : null;
          const target = targetRef && targetId ? parseScore(targetId, (await transaction.get(targetRef)).data()) : null;
          const own = parseScore(this.uid, s.data());
          const result = resolveScores(chest.outcome, own.score, target?.score ?? null);
          const lastOperation = { actor: this.uid, id: questionId };
          transaction.update(scoreRef, { score: result.own, lastOperation });
          if (targetRef && result.target !== null) transaction.update(targetRef, { score: result.target, lastOperation });
          transaction.update(answerRef, { chest: { ...chest, settled: true, targetId, delta: result.own - own.score, fallback: result.fallback } });
          transaction.update(playerRef, { pendingId: null, revision: player.revision + 1,
            lastOperation: { kind: 'claim', id: questionId }, finishedAt: player.completedCount === 40 ? serverTimestamp() : null });
        });
        return;
      } catch (error) {
        const saved = await getDocFromServer(answerRef).catch(() => null);
        const chest = saved?.exists() ? parseAnswer(saved.data()).chest : null;
        if (chest?.settled) {
          if (chest.targetId !== targetId) throw error;
          return;
        }
        if (!(error instanceof FirebaseError) || error.code !== 'permission-denied' || attempt === 4) throw error;
      }
    }
  }
  async finishPlayer(roomId: string) {
    online();
    const reference = doc(this.db, 'rooms', roomId, 'players', this.uid);
    await runTransaction(this.db, async transaction => {
      const [p, r] = await Promise.all([transaction.get(reference), transaction.get(doc(this.db, 'rooms', roomId))]);
      const player = parsePlayer(this.uid, p.data());
      if (player.finishedAt !== null) return;
      this.playing(parseRoom(roomId, r.data()));
      if (player.completedCount !== 40 || player.pendingId || (player.cooldownUntil ?? Infinity) > Date.now()) throw new Error('請先完成最後一題的冷凍。');
      transaction.update(reference, { finishedAt: serverTimestamp(), revision: player.revision + 1,
        lastOperation: { kind: 'finish', id: player.order[39] } });
    }).catch(async error => {
      const saved = await getDocFromServer(reference).catch(() => null);
      if (!saved?.exists() || parsePlayer(this.uid, saved.data()).finishedAt === null) throw error;
    });
  }
  async getPlayers(roomId: string) {
    const [players, scores] = await Promise.all([
      getDocsFromServer(collection(this.db, 'rooms', roomId, 'players')),
      getDocsFromServer(collection(this.db, 'rooms', roomId, 'scores')),
    ]);
    const publicScores = new Map(scores.docs.map(d => [d.id, parseScore(d.id, d.data())]));
    return players.docs.map(d => parsePlayer(d.id, d.data(), publicScores.get(d.id)));
  }
  async publishLeaderboard(roomId: string, players: CloudPlayer[], mode: 'periodic' | 'final' = 'periodic'): Promise<boolean> {
    online();
    const entries = rankedPlayers(players);
    const firstRef = doc(this.db, 'rooms', roomId, 'public', 'leaderboard');
    const secondRef = doc(this.db, 'rooms', roomId, 'public', 'leaderboard2');
    return runTransaction(this.db, async transaction => {
      const [roomDoc, first, second] = await Promise.all([
        transaction.get(doc(this.db, 'rooms', roomId)), transaction.get(firstRef), transaction.get(secondRef),
      ]);
      const status = parseRoom(roomId, roomDoc.data()).status;
      if (mode === 'final' && status !== 'ended' && status !== 'archived') throw new Error('活動結束後才能發布最終排名。');
      if (first.exists() && second.exists()) {
        const buffer = new LeaderboardBuffer();
        buffer.accept(0, first.data());
        const previous = buffer.accept(1, second.data());
        if (previous && JSON.stringify(previous.entries) === JSON.stringify(entries)) return true;
        if (mode === 'periodic' && previous && Date.now() - previous.updatedAt.toMillis() < 10_000) return false;
      }
      // Reading status participates in contention detection: a pre-close writer
      // cannot overwrite the final standings with an old cached roster.
      if (mode === 'periodic' && (status === 'ended' || status === 'archived')) return false;
      transaction.set(firstRef, { entries: entries.slice(0, 15), updatedAt: serverTimestamp() });
      transaction.set(secondRef, { entries: entries.slice(15), updatedAt: serverTimestamp() });
      return true;
    });
  }
  watchAuthorization(next: (allowed: boolean) => void, error: (e: unknown) => void) {
    if (!this.teacherEmail) { next(false); return () => {}; }
    return onSnapshot(doc(this.db, 'teacherEmails', this.teacherEmail), { includeMetadataChanges: true }, snapshot => {
      if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return;
      next(snapshot.data()?.authorized === true);
    }, error);
  }
  watchRooms(next: (rooms: CloudRoom[]) => void, error: (e: unknown) => void) {
    return onSnapshot(query(collection(this.db, 'rooms'), where('ownerUid', '==', this.uid)), { includeMetadataChanges: true }, s => {
      if (s.metadata.fromCache || s.metadata.hasPendingWrites) return;
      try { next(s.docs.map(d => parseRoom(d.id, d.data()))); } catch (e) { error(e); }
    }, error);
  }
  watchRoom(roomId: string, next: (room: CloudRoom) => void, error: (e: unknown) => void) {
    return onSnapshot(doc(this.db, 'rooms', roomId), { includeMetadataChanges: true }, s => {
      if (s.metadata.fromCache || s.metadata.hasPendingWrites) return;
      try { next(parseRoom(s.id, s.data())); } catch (e) { error(e); }
    }, error);
  }
  watchScores(roomId: string, next: (scores: PublicScore[]) => void, error: (e: unknown) => void) {
    return onSnapshot(collection(this.db, 'rooms', roomId, 'scores'), { includeMetadataChanges: true }, s => {
      if (s.metadata.fromCache || s.metadata.hasPendingWrites) return;
      try { next(s.docs.map(d => parseScore(d.id, d.data()))); } catch (e) { error(e); }
    }, error);
  }
  watchPlayers(roomId: string, next: (players: CloudPlayer[]) => void, error: (e: unknown) => void) {
    let players: {id: string; data: unknown}[] | null = null, scores: PublicScore[] | null = null;
    const emit = () => {
      if (!players || !scores) return;
      try {
        if (players.some(p => object(p.data) && !('score' in p.data) && !scores?.some(s => s.id === p.id))) return;
        next(players.map(p => parsePlayer(p.id, p.data, scores?.find(s => s.id === p.id))));
      } catch (e) { error(e); }
    };
    const stopPlayers = onSnapshot(collection(this.db, 'rooms', roomId, 'players'), { includeMetadataChanges: true }, s => {
      if (s.metadata.fromCache || s.metadata.hasPendingWrites) return;
      players = s.docs.map(d => ({ id: d.id, data: d.data() })); emit();
    }, error);
    const stopScores = this.watchScores(roomId, value => { scores = value; emit(); }, error);
    return () => { stopPlayers(); stopScores(); };
  }
  watchProgress(roomId: string, next: (player: CloudPlayer, answers: Record<string, CloudAnswer>) => void, error: (e: unknown) => void) {
    const reference = doc(this.db, 'rooms', roomId, 'players', this.uid);
    let raw: unknown = null, answers: Record<string, CloudAnswer> | null = null, score: PublicScore | undefined;
    const emit = () => {
      if (!raw || !answers) return;
      try {
        if (object(raw) && !('score' in raw) && !score) return;
        const p = parsePlayer(this.uid, raw, score);
        if (Object.keys(answers).length !== p.completedCount || p.order.slice(0, p.completedCount).some((id, i) => answers?.[id]?.ordinal !== i + 1)) return;
        const latest = answers[p.order[p.completedCount - 1] ?? ''];
        if (object(raw) && !('score' in raw) && latest?.correct && ((p.pendingId === null) !== Boolean(latest.chest?.settled))) return;
        next(p, answers);
      } catch (e) { error(e); }
    };
    const stopPlayer = onSnapshot(reference, { includeMetadataChanges: true }, s => {
      if (s.metadata.fromCache || s.metadata.hasPendingWrites) return;
      raw = s.data(); emit();
    }, error);
    const stopAnswers = onSnapshot(collection(reference, 'answers'), { includeMetadataChanges: true }, s => {
      if (s.metadata.fromCache || s.metadata.hasPendingWrites) return;
      try { answers = Object.fromEntries(s.docs.map(d => [d.id, parseAnswer(d.data())])); emit(); } catch (e) { error(e); }
    }, error);
    const stopScore = onSnapshot(doc(this.db, 'rooms', roomId, 'scores', this.uid), { includeMetadataChanges: true }, s => {
      if (s.metadata.fromCache || s.metadata.hasPendingWrites) return;
      try { if (s.exists()) score = parseScore(this.uid, s.data()); emit(); } catch (e) { error(e); }
    }, error);
    return () => { stopPlayer(); stopAnswers(); stopScore(); };
  }
  watchLeaderboard(roomId: string, next: (leaderboard: Leaderboard) => void, error: (e: unknown) => void) {
    const buffer = new LeaderboardBuffer();
    const watch = (page: 0 | 1, id: string) => onSnapshot(doc(this.db, 'rooms', roomId, 'public', id), { includeMetadataChanges: true }, s => {
      if (s.metadata.fromCache || s.metadata.hasPendingWrites || !s.exists()) return;
      try { const result = buffer.accept(page, s.data()); if (result) next(result); } catch (e) { error(e); }
    }, error);
    const first = watch(0, 'leaderboard'), second = watch(1, 'leaderboard2');
    return () => { first(); second(); };
  }
}
