import { expect, it } from "vitest";
import { bank, sections } from "../../src/questions/bank";
import { newPlayer, answer, explain, score } from "../../src/game/session";
it("四單元各十題，所有選項有固定排列", () => {
  const p = newPlayer("小鹿");
  expect(new Set(p.order).size).toBe(40);
  for (const section of sections)
    expect(bank.filter((q) => q.sectionId === section)).toHaveLength(10);
  for (const id of p.order)
    expect([...p.choices[id]!].sort()).toEqual([0, 1, 2, 3]);
});
it("依畫面位置計分，重複操作不重發分數", () => {
  const p = newPlayer("小鹿");
  for (const [index, id] of p.order.entries()) {
    const q = bank.find((q) => q.id === id)!;
    const position = p.choices[id]!.indexOf(q.correctChoiceIndex);
    const choice = index % 2 === 0 ? position : (position + 1) % 4;
    answer(p, id, choice);
    answer(p, id, choice);
    explain(p, id);
    explain(p, id);
  }
  expect(score(p)).toBe(2400);
  expect(Object.keys(p.answers)).toHaveLength(40);
});
