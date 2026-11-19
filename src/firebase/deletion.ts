import {
  collection, doc, getDocFromServer, getDocsFromServer, limit, query,
  runTransaction, serverTimestamp, writeBatch, type Firestore,
} from 'firebase/firestore';
import { object } from './model';

function completed(value: unknown, roomId: string, uid: string): boolean {
  return object(value) && value.roomId === roomId && value.ownerUid === uid && value.state === 'completed';
}
export async function beginRoomDeletion(db: Firestore, uid: string, roomId: string, code: string): Promise<void> {
  const roomRef = doc(db, 'rooms', roomId), retiredRef = doc(db, 'retiredRoomCodes', code);
  await runTransaction(db, async transaction => {
    const retired = (await transaction.get(retiredRef)).data();
    if (completed(retired, roomId, uid)) return;
    const [snapshot, index] = await Promise.all([
      transaction.get(roomRef), transaction.get(doc(db, 'roomCodes', code)),
    ]);
    const room = snapshot.data();
    if (!room || room.ownerUid !== uid || room.code !== code) throw new Error('房間資料不符，無法刪除。');
    if (index.exists() && (index.data()?.roomId !== roomId || index.data()?.ownerUid !== uid)) throw new Error('房間碼索引不一致，請聯絡管理員。');
    if (room.status === 'deleting') {
      if (!object(retired) || retired.roomId !== roomId || retired.ownerUid !== uid || retired.state !== 'deleting') throw new Error('刪除紀錄不一致，請聯絡管理員。');
      return;
    }
    if (room.rulesVersion !== undefined && room.rulesVersion !== 2) throw new Error('無法辨識房間版本，請聯絡管理員。');
    if (!['lobby', 'running', 'paused', 'ended', 'archived'].includes(room.status)) throw new Error('無法辨識房間狀態。');
    if (room.rulesVersion === 2 && !['lobby', 'ended', 'archived'].includes(room.status)) throw new Error('請先結束活動再刪除房間。');
    transaction.update(roomRef, { status: 'deleting', updatedAt: serverTimestamp() });
    transaction.set(retiredRef, { roomId, ownerUid: uid, state: 'deleting' });
    if (index.exists()) transaction.delete(index.ref);
  });
}
export async function deleteRoomData(db: Firestore, uid: string, roomId: string, code: string): Promise<void> {
  const retiredRef = doc(db, 'retiredRoomCodes', code);
  const done = async () => completed((await getDocFromServer(retiredRef)).data(), roomId, uid);
  await beginRoomDeletion(db, uid, roomId, code);
  if (await done()) return;
  // Twenty writes leaves headroom for rule dependencies; repeatedly query remaining
  // documents, never offset into a collection while removing its contents.
  const drain = async (path: string) => {
    for (;;) {
      const page = await getDocsFromServer(query(collection(db, path), limit(20)));
      if (page.empty) return;
      const batch = writeBatch(db);
      page.docs.forEach(document => batch.delete(document.ref));
      await batch.commit();
    }
  };
  try {
    for (;;) {
      const players = await getDocsFromServer(query(collection(db, 'rooms', roomId, 'players'), limit(20)));
      if (players.empty) break;
      for (const player of players.docs) {
        await drain(`${player.ref.path}/answers`);
        await drain(`${player.ref.path}/events`);
        const batch = writeBatch(db); batch.delete(player.ref); await batch.commit();
      }
    }
    await drain(`rooms/${roomId}/scores`);
    await drain(`rooms/${roomId}/public`);
    await runTransaction(db, async transaction => {
      const retired = (await transaction.get(retiredRef)).data();
      if (completed(retired, roomId, uid)) return;
      const roomRef = doc(db, 'rooms', roomId);
      const room = (await transaction.get(roomRef)).data();
      if (!room || room.status !== 'deleting' || room.ownerUid !== uid || room.code !== code) throw new Error('房間狀態已變更，請重試。');
      transaction.delete(roomRef);
      transaction.update(retiredRef, { state: 'completed' });
    });
  } catch (error) {
    // Another authorized tab may have committed the final batch. Only a matching
    // durable receipt establishes completion; permission-denied alone never does.
    if (await done().catch(() => false)) return;
    throw error;
  }
}
