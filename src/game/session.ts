import { bank, questions } from "../questions/bank";
import { GAME_CONFIG } from "./config";

export interface Answer {
  selected: number;
  correct: boolean;
  viewed: boolean;
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
  };
}
export function answer(p: Player, id: string, selected: number) {
  const ordinal = Object.keys(p.answers).length;
  if (
    p.order[ordinal] !== id ||
    !Number.isInteger(selected) ||
    selected < 0 ||
    selected > 3
  )
    return;
  const question = questions.get(id)!;
  p.answers[id] = {
    selected,
    correct: p.choices[id]![selected] === question.correctChoiceIndex,
    viewed: false,
  };
  if (ordinal + 1 === p.order.length) p.finishedAt = Date.now();
}
export function explain(p: Player, id: string) {
  const a = p.answers[id];
  if (a) a.viewed = true;
}
export function score(p: Player) {
  return Object.values(p.answers).reduce(
    (sum, a) =>
      sum +
      (a.correct
        ? GAME_CONFIG.correctAnswerPoints
        : a.viewed
          ? GAME_CONFIG.incorrectExplanationPoints
          : 0),
    0,
  );
}
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
