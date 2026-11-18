// 僅包含 SPEC.md §13 已確認的值；命運事件分布與效果尚待確認。
export const GAME_CONFIG = Object.freeze({
  questionCount: 40,
  questionsPerSection: 10,
  correctAnswerPoints: 100,
  incorrectExplanationPoints: 20,
  minimumScore: 0,
  luckEventInterval: 3,
  minimumLuckDelta: -30,
  maximumLuckDelta: 80,
});
