import { GAME_CONFIG } from "./config";
import { remainingTime, type Timer } from "./rewards";
import { validRoom } from "./validate";
import { newPlayer, ranking, type Player } from "./session";

export type Status = "lobby" | "running" | "paused" | "ended";
export interface Room extends Timer {
  rulesVersion: 2;
  code: string;
  status: Status;
  players: Player[];
  entries: ReturnType<typeof ranking>;
  updated: number;
}
const prefix = "literature-quest.v2.";
export const demoCode = "DEMO01";
const retiredPrefix = "literature-quest.retired.";
export function isRetired(code: string): boolean {
  return localStorage.getItem(retiredPrefix + code) !== null;
}
export function getDeletionState(code: string): 'deleting' | 'completed' | null {
  const state = localStorage.getItem(retiredPrefix + code);
  if (state === null) return null;
  // Older builds wrote "deleted" before cleanup. Inspect raw keys, without
  // parsing potentially damaged saves, rather than assuming that meant success.
  if (state === 'deleted') return localStorage.getItem(prefix + code) === null
    && localStorage.getItem('quest.identity.' + code) === null ? 'completed' : 'deleting';
  return state === 'completed' ? 'completed' : 'deleting';
}
export async function deleteRoom(code: string): Promise<void> {
  if (!navigator.locks) throw new Error("請使用 localhost 或 HTTPS 開啟本機示範。");
  await navigator.locks.request(prefix + code, () => {
    const room = readRoom(code);
    if (room?.status === "running" || room?.status === "paused") throw new Error("請先結束活動再刪除房間。");
    // Persist the barrier first. A partial storage failure can safely be retried.
    localStorage.setItem(retiredPrefix + code, "deleting");
    localStorage.removeItem(prefix + code);
    localStorage.removeItem("quest.identity." + code);
    sessionStorage.removeItem("quest.tab." + code);
    localStorage.setItem(retiredPrefix + code, "completed");
  });
}
export function readRoom(code: string): Room | null {
  const raw = localStorage.getItem(prefix + code);
  if (raw === null) return null;
  const parsed: unknown = JSON.parse(raw);
  if (!validRoom(parsed, code)) throw new Error("此房間的本機存檔無法讀取。");
  return parsed;
}
export async function update<T>(
  code: string,
  apply: (room: Room) => T,
  create = false,
): Promise<T> {
  if (!navigator.locks)
    throw new Error(
      "請使用 localhost 或 HTTPS 開啟本機示範，以便安全保存進度。",
    );
  return navigator.locks.request(prefix + code, () => {
    if (isRetired(code)) throw new Error("房間已刪除，請向老師索取新房間碼。");
    const current = readRoom(code);
    if (!current && !create)
      throw new Error("本機房間不存在，請返回學生入口。");
    const room: Room = current ?? {
      code,
      rulesVersion: 2,
      durationMinutes: GAME_CONFIG.defaultDurationMinutes,
      remainingMs: GAME_CONFIG.defaultDurationMinutes * 60000,
      runningSince: null,
      status: "lobby",
      players: [],
      entries: [],
      updated: 0,
    };
    const before = JSON.stringify(current);
    expireRoom(room);
    const result = apply(room);
    const serialized = JSON.stringify(room);
    if (before !== serialized) localStorage.setItem(prefix + code, serialized);
    return result;
  });
}
export async function join(code: string, nickname: string) {
  if (isRetired(code)) throw new Error("房間已刪除，請向老師索取新房間碼。");
  if (!readRoom(code) && code !== demoCode)
    throw new Error("找不到此本機房間，請核對六位房間碼。");
  if ([...nickname].length < 2 || [...nickname].length > 12)
    throw new Error("暱稱請輸入 2 至 12 個字。");
  return update(
    code,
    (room) => {
      if (room.status !== "lobby")
        throw new Error("房間已停止加入，請向老師索取新房間碼。");
      if (room.players.length >= 30) throw new Error("房間已滿 30 人。");
      const player = newPlayer(nickname);
      room.players.push(player);
      return player.id;
    },
    code === demoCode,
  );
}
export function publish(room: Room) {
  if (room.updated && Date.now() - room.updated < 10000) return;
  const entries = ranking(room.players);
  if (
    !room.updated ||
    JSON.stringify(entries) !== JSON.stringify(room.entries)
  ) {
    room.entries = entries;
    room.updated = Date.now();
  }
}

export function setDuration(room: Room, minutes: number) {
  if (room.status !== "lobby" || !Number.isInteger(minutes) || minutes < 1 || minutes > 60) return;
  room.durationMinutes = minutes;
  room.remainingMs = minutes * 60000;
}
export function expireRoom(room: Room, now = Date.now()) {
  if (room.status === "running" && remainingTime(room, now) === 0) setStatus(room, "ended", now);
}
export function setStatus(room: Room, status: Status, now = Date.now()) {
  if (room.status === "ended") return;
  if (status === "ended") {
    room.status = "ended";
    room.remainingMs = 0;
    room.runningSince = null;
    room.entries = ranking(room.players);
    room.updated = now;
  } else if (status === "running" && (room.status === "lobby" || room.status === "paused") && room.remainingMs > 0) {
    room.status = "running";
    room.runningSince = now;
  } else if (status === "paused" && room.status === "running") {
    room.remainingMs = remainingTime(room, now);
    room.runningSince = null;
    room.status = room.remainingMs > 0 ? "paused" : "ended";
  }
}
