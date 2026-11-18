export type ChoiceIndex = 0 | 1 | 2 | 3;

export type Question = {
  id: string;
  sectionId: string;
  stem: string;
  choices: [string, string, string, string];
  correctChoiceIndex: ChoiceIndex;
  explanation: string;
  difficulty: 'easy' | 'medium' | 'hard';
  sourceReference?: string;
  verificationStatus: 'pending_source_review' | 'teacher_verified';
};
