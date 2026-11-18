import { FirebaseError } from 'firebase/app';
import type { User } from 'firebase/auth';
import {
  collection, doc, getDocFromServer, getDocsFromServer, onSnapshot, query, where,
  runTransaction, serverTimestamp, setDoc, writeBatch, type Firestore,
} from 'firebase/firestore';
import { newPlayer } from '../game/session';
import { questions } from '../questions/bank';
import {
  LeaderboardBuffer, object, parseAnswer, parsePlayer, parseRoom, questionSetVersion, rankedPlayers,
  type CloudAnswer, type CloudPlayer, type CloudRoom, type Leaderboard, type RoomStatus,
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
  async createRoom(): Promise<CloudRoom> {
    online();
    if (!await this.isTeacher()) throw new Error('帳號尚未獲得老師授權。');
    for (let attempt = 0; attempt < 5; attempt++) {
      const bytes = crypto.getRandomValues(new Uint8Array(6));
      const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      const code = [...bytes].map(n => alphabet[n % alphabet.length]).join('');
      const reference = doc(collection(this.db, 'rooms'));
      const room: CloudRoom = { id: reference.id, code, ownerUid: this.uid, status: 'lobby', questionSetVersion };
      if ((await getDocFromServer(doc(this.db, 'roomCodes', code))).exists()) continue;
      const batch = writeBatch(this.db);
      batch.set(reference, { code, ownerUid: this.uid, status: 'lobby', questionSetVersion,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(), startedAt: null, endedAt: null });
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
      return { room: parseRoom(roomId, room.data()), player: parsePlayer(this.uid, player.data()) };
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
      try {
        await setDoc(reference, { nickname, joinedAt: serverTimestamp(), questionOrder: player.order,
          choiceOrders: player.choices, completedCount: 0, score: 0, eventCount: 0, revision: 0,
          lastOperation: null, finishedAt: null });
      } catch (error) {
        // A second tab may have joined the same UID. Never reset that record.
        const saved = await getDocFromServer(reference).catch(() => null);
        if (!saved?.exists()) throw error;
      }
    }
    const [room, player] = await Promise.all([
      getDocFromServer(doc(this.db, 'rooms', roomId)), getDocFromServer(reference),
    ]);
    return { room: parseRoom(roomId, room.data()), player: parsePlayer(this.uid, player.data()) };
  }
  async setStatus(roomId: string, next: RoomStatus) {
    online();
    const reference = doc(this.db, 'rooms', roomId);
    await runTransaction(this.db, async transaction => {
      const room = parseRoom(roomId, (await transaction.get(reference)).data());
      if (room.status === next) return;
      transaction.update(reference, { status: next, updatedAt: serverTimestamp(),
        ...(room.status === 'lobby' && next === 'running' ? { startedAt: serverTimestamp() } : {}),
        ...(next === 'ended' ? { endedAt: serverTimestamp() } : {}) });
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
      if (parseRoom(roomId, roomDoc.data()).status !== 'running') throw new Error('活動目前無法作答。');
      const question = questions.get(questionId);
      if (!question || player.order[player.completedCount] !== questionId) throw new Error('題目進度已更新，請重新載入。');
      const isCorrect = player.choices[questionId]?.[selected] === question.correctChoiceIndex;
      const awardedPoints = isCorrect ? 100 : 0;
      transaction.set(answerRef, { ordinal: player.completedCount + 1, selectedChoice: selected, isCorrect,
        explanationViewed: false, awardedPoints, answeredAt: serverTimestamp(), explanationViewedAt: null });
      transaction.update(playerRef, { completedCount: player.completedCount + 1, score: player.totalScore + awardedPoints,
        revision: player.revision + 1, lastOperation: { kind: 'answer', id: questionId },
        finishedAt: player.completedCount === 39 ? serverTimestamp() : null });
    }).catch(async error => {
      // Rules can reject a stale concurrent commit before Firestore retries it.
      // Reconcile the immutable answer; never replay an increment blindly.
      const saved = await getDocFromServer(answerRef).catch(() => null);
      if (saved?.exists() && parseAnswer(saved.data()).selected === selected) return;
      throw error;
    });
  }
  async claimExplanation(roomId: string, questionId: string) {
    online();
    const playerRef = doc(this.db, 'rooms', roomId, 'players', this.uid);
    const answerRef = doc(collection(playerRef, 'answers'), questionId);
    await runTransaction(this.db, async transaction => {
      const [playerDoc, answerDoc, roomDoc] = await Promise.all([
        transaction.get(playerRef), transaction.get(answerRef), transaction.get(doc(this.db, 'rooms', roomId)),
      ]);
      const player = parsePlayer(this.uid, playerDoc.data()), answer = parseAnswer(answerDoc.data());
      if (answer.correct || answer.viewed) return;
      if (parseRoom(roomId, roomDoc.data()).status !== 'running') throw new Error('恢復作答後才能領取詳解分數。');
      transaction.update(answerRef, { explanationViewed: true, explanationViewedAt: serverTimestamp(), awardedPoints: 20 });
      transaction.update(playerRef, { score: player.totalScore + 20, revision: player.revision + 1,
        lastOperation: { kind: 'explanation', id: questionId } });
    }).catch(async error => {
      const saved = await getDocFromServer(answerRef).catch(() => null);
      if (saved?.exists() && parseAnswer(saved.data()).viewed) return;
      throw error;
    });
  }
  async getPlayers(roomId: string) {
    return (await getDocsFromServer(collection(this.db, 'rooms', roomId, 'players'))).docs.map(d => parsePlayer(d.id, d.data()));
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
  watchPlayers(roomId: string, next: (players: CloudPlayer[]) => void, error: (e: unknown) => void) {
    return onSnapshot(collection(this.db, 'rooms', roomId, 'players'), { includeMetadataChanges: true }, s => {
      if (s.metadata.fromCache || s.metadata.hasPendingWrites) return;
      try { next(s.docs.map(d => parsePlayer(d.id, d.data()))); } catch (e) { error(e); }
    }, error);
  }
  watchProgress(roomId: string, next: (player: CloudPlayer, answers: Record<string, CloudAnswer>) => void, error: (e: unknown) => void) {
    const reference = doc(this.db, 'rooms', roomId, 'players', this.uid);
    let player: CloudPlayer | null = null, answers: Record<string, CloudAnswer> | null = null;
    const emit = () => {
      if (!player || !answers || Object.keys(answers).length !== player.completedCount) return;
      const current = player;
      if (current.order.slice(0, current.completedCount).some((id, i) => answers?.[id]?.ordinal !== i + 1)) return;
      if (Object.values(answers).reduce((sum, a) => sum + a.points, 0) !== current.totalScore) return;
      next(current, answers);
    };
    const stopPlayer = onSnapshot(reference, { includeMetadataChanges: true }, s => {
      if (s.metadata.fromCache || s.metadata.hasPendingWrites) return;
      try { player = parsePlayer(this.uid, s.data()); emit(); } catch (e) { error(e); }
    }, error);
    const stopAnswers = onSnapshot(collection(reference, 'answers'), { includeMetadataChanges: true }, s => {
      if (s.metadata.fromCache || s.metadata.hasPendingWrites) return;
      try { answers = Object.fromEntries(s.docs.map(d => [d.id, parseAnswer(d.data())])); emit(); } catch (e) { error(e); }
    }, error);
    return () => { stopPlayer(); stopAnswers(); };
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
