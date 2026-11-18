import { GAME_CONFIG } from "./config";
export type ChestOutcome =
  | { kind: "gain" | "loss"; amount: number }
  | { kind: "steal" | "swap"; amount: 0 };
export interface Chest {
  box: number;
  outcome: ChestOutcome;
  targetId: string | null;
  settled: boolean;
  delta: number;
  fallback: boolean;
}
export interface Timer {
  durationMinutes: number;
  remainingMs: number;
  runningSince: number | null;
}
export const maxScore = GAME_CONFIG.maximumScore;
export const freezeMs = GAME_CONFIG.freezeMs;
export function remainingTime(timer: Timer, now = Date.now()): number {
  return Math.max(0, timer.remainingMs - (timer.runningSince === null ? 0 : Math.max(0, now - timer.runningSince)));
}
function random() {
  return crypto.getRandomValues(new Uint32Array(1))[0]! / 4294967296;
}
export function drawChest(sample: () => number = random): ChestOutcome {
  const category = sample(), value = sample(), chest = GAME_CONFIG.chest;
  const weighted = (values: typeof chest.gain) => {
    const total = values.reduce((sum, entry) => sum + entry.weight, 0);
    let cumulative = 0;
    for (const entry of values) {
      cumulative += entry.weight;
      if (value * total < cumulative) return entry.amount;
    }
    return values[values.length - 1]!.amount;
  };
  const weights = chest.categoryWeights;
  const total = weights.gain + weights.steal + weights.swap + weights.loss;
  if (category * total < weights.gain) return { kind: "gain", amount: weighted(chest.gain) };
  if (category * total < weights.gain + weights.steal) return { kind: "steal", amount: 0 };
  if (category * total < weights.gain + weights.steal + weights.swap) return { kind: "swap", amount: 0 };
  return { kind: "loss", amount: weighted(chest.loss) };
}
export function resolveScores(outcome: ChestOutcome, own: number, target: number | null): { own: number; target: number | null; fallback: boolean } {
  switch (outcome.kind) {
    case "gain": return { own: own + outcome.amount, target, fallback: false };
    case "loss": return { own: Math.max(0, own - outcome.amount), target, fallback: false };
    case "steal": {
      if (target === null) return { own: own + GAME_CONFIG.chest.soloFallback, target, fallback: true };
      const amount = Math.min(GAME_CONFIG.chest.stealMaximum, target);
      return { own: own + amount, target: target - amount, fallback: false };
    }
    case "swap": return target === null
      ? { own: own + GAME_CONFIG.chest.soloFallback, target, fallback: true }
      : { own: target, target: own, fallback: false };
  }
}
