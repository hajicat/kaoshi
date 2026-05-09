export interface QuestionOption {
  key: string;
  text: string;
}

export function checkAnswer(
  questionType: string,
  correctAnswer: string[],
  userAnswer: string[]
): boolean {
  if (!userAnswer || userAnswer.length === 0) return false;

  const sortedCorrect = [...correctAnswer].sort();
  const sortedUser = [...userAnswer].sort();

  if (questionType === "single" || questionType === "boolean") {
    return sortedCorrect[0] === sortedUser[0];
  }

  if (questionType === "multiple") {
    return (
      sortedCorrect.length === sortedUser.length &&
      sortedCorrect.every((v, i) => v === sortedUser[i])
    );
  }

  // essay 类型需要人工评分
  return false;
}

export function calculateScore(
  questions: Array<{
    questionId: string;
    type: string;
    answerJson: string;
    score: number;
  }>,
  userAnswers: Array<{
    questionId: string;
    answer: string[];
  }>
): {
  totalScore: number;
  earnedScore: number;
  results: Array<{
    questionId: string;
    isCorrect: boolean | null;
    earnedScore: number;
    needsGrading: boolean;
  }>;
} {
  let totalScore = 0;
  let earnedScore = 0;
  const results: Array<{
    questionId: string;
    isCorrect: boolean | null;
    earnedScore: number;
    needsGrading: boolean;
  }> = [];

  for (const q of questions) {
    totalScore += q.score;
    const userAnswer = userAnswers.find((a) => a.questionId === q.questionId);
    const correctAnswer = JSON.parse(q.answerJson) as string[];

    if (q.type === "essay") {
      results.push({
        questionId: q.questionId,
        isCorrect: null,
        earnedScore: 0,
        needsGrading: true,
      });
      continue;
    }

    const isCorrect = checkAnswer(
      q.type,
      correctAnswer,
      userAnswer?.answer ?? []
    );
    const score = isCorrect ? q.score : 0;
    earnedScore += score;

    results.push({
      questionId: q.questionId,
      isCorrect,
      earnedScore: score,
      needsGrading: false,
    });
  }

  return { totalScore, earnedScore, results };
}
