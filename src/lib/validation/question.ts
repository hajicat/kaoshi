import { z } from "zod";

export const QuestionTypeSchema = z.enum([
  "single",
  "multiple",
  "boolean",
  "essay",
]);

export const OptionSchema = z.object({
  key: z.string(),
  text: z.string(),
});

export const ParsedQuestionSchema = z.object({
  type: QuestionTypeSchema,
  stem: z.string().min(1),
  options: z.array(OptionSchema),
  answer: z.array(z.string()),
  referenceAnswer: z.string().optional(),
  analysis: z.string().optional(),
  score: z.number().int().positive().default(1),
  tags: z.array(z.string()).default([]),
  difficulty: z.enum(["easy", "medium", "hard"]).optional(),
});

export const ParsedQuestionBankSchema = z.object({
  questions: z.array(ParsedQuestionSchema),
});

export const CreateQuestionBankSchema = z.object({
  title: z.string().min(1, "请输入题库标题"),
  description: z.string().optional(),
  subject: z.string().optional(),
  version: z.string().optional(),
});

export const UpdateQuestionBankSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  subject: z.string().optional(),
  version: z.string().optional(),
  status: z.enum(["draft", "published", "archived"]).optional(),
});

export const SubmitAnswerSchema = z.object({
  questionId: z.string(),
  answer: z.array(z.string()),
});

export const SubmitAttemptSchema = z.object({
  answers: z.array(SubmitAnswerSchema),
});
