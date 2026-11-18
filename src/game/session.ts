import { bank, questions } from "../questions/bank";
import { drawChest, resolveScores, freezeMs, type Chest } from "./rewards";

export interface Answer {
  selected: number;
  correct: boolean;
  viewed: boolean;
  answeredAt: number;
  chest: Chest | null;
}
export interface Player {
  id: string;
  nickname: string;
  joinedAt: number;
  finishedAt: number | null;
  order: string[];
  choices: Record<string, number[]>;
  answers: Record<string, Answer>;
  cursor: number;
  totalScore: number;
  cooldownUntil: number | null;
  pendingId: string | null;
}
function shuffle<T>(values: T[]): T[] {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}
export function newPlayer(nickname: string): Player {
  return {
    id: crypto.randomUUID(),
    nickname,
    joinedAt: Date.now(),
    finishedAt: null,
    order: shuffle(bank.map((q) => q.id)),
    choices: Object.fromEntries(bank.map((q) => [q.id, shuffle([0, 1, 2, 3])])),
    answers: {},
    cursor: 0,
    totalScore: 0,
    cooldownUntil: null,
    pendingId: null,
  };
}
export function answer(p: Player, id: string, selected: number, now = Date.now()) {
  const ordinal = Object.keys(p.answers).length;
  if (p.pendingId || (p.cooldownUntil !== null && now < p.cooldownUntil) ||
    p.order[ordinal] !== id || p.cursor !== ordinal ||
    !Number.isInteger(selected) || selected < 0 || selected > 3) return;
  const correct = p.choices[id]![selected] === questions.get(id)!.correctChoiceIndex;
  p.answers[id] = { selected, correct, viewed: false, answeredAt: now, chest: null };
  p.pendingId = correct ? id : null;
  p.cooldownUntil = correct ? null : now + freezeMs;
  if (ordinal + 1 === p.order.length && !correct) p.finishedAt = now + freezeMs;
}
export function explain(p: Player, id: string) {
  const a = p.answers[id];
  if (a) a.viewed = true;
}
export function openChest(p: Player, id: string, box: number, sample?: () => number) {
  const a = p.answers[id];
  if (!a?.correct || p.pendingId !== id || !Number.isInteger(box) || box < 0 || box > 2) return;
  if (!a.chest) a.chest = { box, outcome: drawChest(sample), targetId: null, settled: false, delta: 0, fallback: false };
  return a.chest;
}
export function claimChest(p: Player, id: string, target: Player | null, hasPeers = false, now = Date.now()) {
  const chest = p.answers[id]?.chest;
  if (!chest || chest.settled || p.pendingId !== id) return;
  const needsTarget = chest.outcome.kind === "steal" || chest.outcome.kind === "swap";
  if (needsTarget && (target?.id === p.id || (hasPeers && !target))) return;
  const result = resolveScores(chest.outcome, p.totalScore, needsTarget && target ? target.totalScore : null);
  chest.delta = result.own - p.totalScore;
  chest.targetId = needsTarget ? target?.id ?? null : null;
  chest.fallback = result.fallback;
  chest.settled = true;
  p.totalScore = result.own;
  if (needsTarget && target && result.target !== null) target.totalScore = result.target;
  p.pendingId = null;
  if (Object.keys(p.answers).length === p.order.length) p.finishedAt = now;
}
export function nextQuestion(p: Player, now = Date.now()) {
  if (!p.answers[p.order[p.cursor] ?? ""] || p.pendingId ||
    (p.cooldownUntil !== null && now < p.cooldownUntil)) return;
  p.cursor++;
}
export function score(p: Player) { return p.totalScore; }
export function ranking(players: Player[]) {
  return [...players]
    .sort(
      (a, b) =>
        score(b) - score(a) ||
        (a.finishedAt ?? Infinity) - (b.finishedAt ?? Infinity) ||
        a.joinedAt - b.joinedAt ||
        a.id.localeCompare(b.id),
    )
    .slice(0, 30)
    .map((p) => ({ nickname: p.nickname, score: score(p) }));
}
