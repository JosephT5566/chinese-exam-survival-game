import { questions, sections } from "../questions/bank";
import type { Player } from "./session";
import type { Room } from "./local";
const object = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);
const integer = (x: unknown): x is number =>
  typeof x === "number" && Number.isSafeInteger(x) && x >= 0;
function validPlayer(p: unknown): p is Player {
  if (
    !object(p) ||
    typeof p.id !== "string" ||
    typeof p.nickname !== "string" ||
    !integer(p.joinedAt) ||
    !(p.finishedAt === null || integer(p.finishedAt))
  )
    return false;
  const { order, choices, answers, cursor } = p;
  if (
    !Array.isArray(order) ||
    order.length !== 40 ||
    new Set(order).size !== 40 ||
    !order.every((id) => questions.has(id)) ||
    !object(choices) ||
    !object(answers) ||
    !integer(cursor)
  )
    return false;
  if (
    sections.some(
      (s) =>
        order.filter((id) => questions.get(id)?.sectionId === s).length !== 10,
    )
  )
    return false;
  if (
    !order.every((id) => {
      const c = choices[id];
      return (
        Array.isArray(c) &&
        [...c].sort().join(",") === "0,1,2,3" &&
        c.every(integer)
      );
    })
  )
    return false;
  const count = Object.keys(answers).length;
  if (
    cursor > 40 ||
    count < cursor ||
    count > cursor + 1 ||
    (count === 40) !== (p.finishedAt !== null)
  )
    return false;
  return order.slice(0, count).every((id) => {
    const a = answers[id],
      c = choices[id];
    return (
      object(a) &&
      integer(a.selected) &&
      a.selected < 4 &&
      Array.isArray(c) &&
      a.correct === (c[a.selected] === questions.get(id)!.correctChoiceIndex) &&
      typeof a.viewed === "boolean"
    );
  });
}
export function validRoom(x: unknown, code: string): x is Room {
  return (
    object(x) &&
    x.code === code &&
    ["lobby", "running", "paused", "ended"].some((s) => s === x.status) &&
    Array.isArray(x.players) &&
    x.players.length <= 30 &&
    x.players.every(validPlayer) &&
    Array.isArray(x.entries) &&
    x.entries.length <= 30 &&
    x.entries.every(
      (e) => object(e) && typeof e.nickname === "string" && integer(e.score),
    ) &&
    integer(x.updated)
  );
}
