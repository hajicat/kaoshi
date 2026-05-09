import {
  sqliteTable,
  text,
  integer,
  real,
} from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";

// ============ 用户表 ============
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  nickname: text("nickname").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["admin", "user"] }).notNull(),
  status: text("status", { enum: ["active", "disabled"] })
    .notNull()
    .default("active"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// ============ 题库表 ============
export const questionBanks = sqliteTable("question_banks", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  subject: text("subject"),
  version: text("version"),
  status: text("status", {
    enum: ["draft", "published", "archived"],
  })
    .notNull()
    .default("draft"),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// ============ 题目表 ============
export const questions = sqliteTable("questions", {
  id: text("id").primaryKey(),
  bankId: text("bank_id").notNull(),
  type: text("type", {
    enum: ["single", "multiple", "boolean", "essay"],
  }).notNull(),
  stem: text("stem").notNull(),
  optionsJson: text("options_json").notNull(),
  answerJson: text("answer_json").notNull(),
  referenceAnswer: text("reference_answer"),
  analysis: text("analysis"),
  score: integer("score").notNull().default(1),
  difficulty: text("difficulty", {
    enum: ["easy", "medium", "hard"],
  }),
  tagsJson: text("tags_json"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// ============ 答题记录表 ============
export const attempts = sqliteTable("attempts", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  bankId: text("bank_id").notNull(),
  status: text("status", {
    enum: ["in_progress", "submitted", "graded"],
  })
    .notNull()
    .default("in_progress"),
  totalScore: integer("total_score"),
  earnedScore: integer("earned_score"),
  startedAt: text("started_at").notNull(),
  submittedAt: text("submitted_at"),
  gradedAt: text("graded_at"),
  createdAt: text("created_at").notNull(),
});

// ============ 答题详情表 ============
export const attemptAnswers = sqliteTable("attempt_answers", {
  id: text("id").primaryKey(),
  attemptId: text("attempt_id").notNull(),
  questionId: text("question_id").notNull(),
  userAnswerJson: text("user_answer_json"),
  isCorrect: integer("is_correct"), // 0/1/null
  earnedScore: integer("earned_score"),
  needsGrading: integer("needs_grading").notNull().default(0), // 0/1
  gradedBy: text("graded_by"),
  gradedAt: text("graded_at"),
  createdAt: text("created_at").notNull(),
});

// ============ 导入任务表 ============
export const importJobs = sqliteTable("import_jobs", {
  id: text("id").primaryKey(),
  bankId: text("bank_id"),
  filename: text("filename").notNull(),
  fileKey: text("file_key"),
  status: text("status", {
    enum: ["uploading", "parsing", "parsed", "confirming", "done", "failed"],
  })
    .notNull()
    .default("uploading"),
  parsedJson: text("parsed_json"),
  errorMessage: text("error_message"),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// ============ PK 对战表 ============
export const pkMatches = sqliteTable("pk_matches", {
  id: text("id").primaryKey(),
  bankId: text("bank_id").notNull(),
  creatorId: text("creator_id").notNull(),
  opponentId: text("opponent_id"),
  status: text("status", {
    enum: ["waiting", "active", "finished", "cancelled"],
  })
    .notNull()
    .default("waiting"),
  creatorScore: integer("creator_score"),
  opponentScore: integer("opponent_score"),
  creatorTimeMs: integer("creator_time_ms"),
  opponentTimeMs: integer("opponent_time_ms"),
  winnerId: text("winner_id"),
  startedAt: text("started_at"),
  finishedAt: text("finished_at"),
  createdAt: text("created_at").notNull(),
});

// ============ 关系定义 ============
export const usersRelations = relations(users, ({ many }) => ({
  attempts: many(attempts),
  createdBanks: many(questionBanks),
}));

export const questionBanksRelations = relations(questionBanks, ({ many }) => ({
  questions: many(questions),
  attempts: many(attempts),
}));

export const questionsRelations = relations(questions, ({ one }) => ({
  bank: one(questionBanks, {
    fields: [questions.bankId],
    references: [questionBanks.id],
  }),
}));

export const attemptsRelations = relations(attempts, ({ one, many }) => ({
  user: one(users, {
    fields: [attempts.userId],
    references: [users.id],
  }),
  bank: one(questionBanks, {
    fields: [attempts.bankId],
    references: [questionBanks.id],
  }),
  answers: many(attemptAnswers),
}));

export const attemptAnswersRelations = relations(attemptAnswers, ({ one }) => ({
  attempt: one(attempts, {
    fields: [attemptAnswers.attemptId],
    references: [attempts.id],
  }),
  question: one(questions, {
    fields: [attemptAnswers.questionId],
    references: [questions.id],
  }),
}));
