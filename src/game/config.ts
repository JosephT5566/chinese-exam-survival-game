export const GAME_CONFIG = Object.freeze({
  questionCount: 40,
  questionsPerSection: 10,
  minimumScore: 0,
  maximumScore: 96000,
  freezeMs: 3000,
  defaultDurationMinutes: 20,
  chest: {
    categoryWeights: { gain: 50, steal: 20, swap: 10, loss: 20 },
    gain: [{ amount: 20, weight: 30 }, { amount: 50, weight: 50 }, { amount: 80, weight: 20 }],
    loss: [{ amount: 10, weight: 50 }, { amount: 20, weight: 30 }, { amount: 30, weight: 20 }],
    stealMaximum: 100,
    soloFallback: 20,
  },
});
