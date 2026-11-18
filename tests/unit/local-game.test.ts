import { afterEach, expect, it, vi } from "vitest";
import { questions } from "../../src/questions/bank";
import {
  answer,
  explain,
  newPlayer,
  ranking,
  score,
} from "../../src/game/session";
import { publish, type Room } from "../../src/game/local";
import { validRoom } from "../../src/game/validate";

function setup() {
  const p = newPlayer("松果");
  const room: Room = {
    code: "DEMO01",
    status: "running",
    players: [p],
    entries: [],
    updated: 0,
  };
  const id = p.order[0]!,
    q = questions.get(id)!;
  const right = p.choices[id]!.indexOf(q.correctChoiceIndex);
  return { p, room, id, right };
}
afterEach(() => vi.restoreAllMocks());
it("拒絕越界、非整數、跳題與過期的答案", () => {
  const { p, id, right } = setup();
  for (const pos of [-1, 4, 1.2, NaN]) answer(p, id, pos);
  answer(p, p.order[1]!, right);
  expect(p.answers).toEqual({});
  answer(p, id, right);
  p.cursor++;
  answer(p, id, (right + 1) % 4);
  expect(Object.keys(p.answers)).toEqual([id]);
  expect(score(p)).toBe(100);
});
it("錯題詳解前為零，重載後只領一次20分", () => {
  const { p, id, right, room } = setup();
  answer(p, id, (right + 1) % 4);
  expect(score(p)).toBe(0);
  const restored: unknown = JSON.parse(JSON.stringify(room));
  expect(validRoom(restored, room.code)).toBe(true);
  if (!validRoom(restored, room.code)) throw new Error("存檔無效");
  const saved = restored.players[0]!;
  expect(saved.order).toEqual(p.order);
  expect(saved.choices).toEqual(p.choices);
  expect(score(saved)).toBe(0);
  explain(saved, id);
  explain(saved, id);
  expect(score(saved)).toBe(20);
});
it("拒絕缺題、排列重複與欄位損毀的存檔", () => {
  const { room, p, id } = setup();
  expect(validRoom({}, room.code)).toBe(false);
  p.choices[id] = [1, 1, 2, 3];
  expect(validRoom(room, room.code)).toBe(false);
  p.choices[id] = [0, 1, 2, 3];
  p.order.pop();
  expect(validRoom(room, room.code)).toBe(false);
});
it("跨分頁重複發布也受十秒限制，無變更不更新戳記", () => {
  const { room, p, id, right } = setup();
  const clock = vi.spyOn(Date, "now").mockReturnValue(1000);
  publish(room);
  answer(p, id, right);
  clock.mockReturnValue(10999);
  publish(room);
  expect(room.entries[0]?.score).toBe(0);
  clock.mockReturnValue(11000);
  publish(room);
  expect(room.entries[0]?.score).toBe(100);
  clock.mockReturnValue(21001);
  publish(room);
  expect(room.updated).toBe(11000);
});
it("公開列表只包含分數與暱稱，同分依完成時間、加入次序排序", () => {
  const a = newPlayer("阿樹"),
    b = newPlayer("阿花"),
    c = newPlayer("阿草");
  a.finishedAt = 200;
  b.finishedAt = 100;
  expect(ranking([c, a, b])).toEqual(
    ["阿花", "阿樹", "阿草"].map((nickname) => ({ nickname, score: 0 })),
  );
});
