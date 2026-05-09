const DEEPSEEK_API_URL = "https://api.deepseek.com/v1/chat/completions";

interface Question {
  type: "single" | "multiple" | "boolean" | "essay";
  stem: string;
  options: Array<{ key: string; text: string }>;
  answer: string[];
  analysis?: string;
  referenceAnswer?: string;
  score: number;
  difficulty?: "easy" | "medium" | "hard";
}

const PARSE_PROMPT = `你是一个专业的题目解析助手。请将用户提供的文本内容解析为结构化的题目数据。

规则：
1. 识别题型：单选(single)、多选(multiple)、判断(boolean)、简答(essay)
2. 识别题干、选项、答案、解析
3. 判断题的选项固定为 A.正确 B.错误
4. 简答题的 answer 为空数组，答案放在 referenceAnswer 字段
5. 根据内容判断难度：easy/medium/hard
6. 每题默认 1 分，简答题默认 5 分

请直接返回 JSON 数组，不要包含任何其他文字。格式：
[
  {
    "type": "single",
    "stem": "题目内容",
    "options": [{"key": "A", "text": "选项内容"}, ...],
    "answer": ["A"],
    "analysis": "解析说明",
    "score": 1,
    "difficulty": "easy"
  }
]`;

export async function parseWithDeepSeek(content: string): Promise<{ questions: Question[] }> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error("DEEPSEEK_API_KEY 未配置");
  }

  const response = await fetch(DEEPSEEK_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [
        { role: "system", content: PARSE_PROMPT },
        { role: "user", content: `请解析以下题目内容：\n\n${content}` },
      ],
      temperature: 0.1,
      max_tokens: 8192,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`DeepSeek API 错误 (${response.status}): ${err}`);
  }

  const data = await response.json();
  const raw = data.choices?.[0]?.message?.content;
  if (!raw) {
    throw new Error("DeepSeek 返回内容为空");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("DeepSeek 返回的 JSON 格式无效");
  }

  // 兼容返回格式：可能是 { questions: [...] } 或直接 [...]
  let questions: Question[];
  if (Array.isArray(parsed)) {
    questions = parsed;
  } else if (
    typeof parsed === "object" &&
    parsed !== null &&
    "questions" in parsed &&
    Array.isArray((parsed as { questions: unknown }).questions)
  ) {
    questions = (parsed as { questions: Question[] }).questions;
  } else {
    throw new Error("DeepSeek 返回的数据结构不符合预期");
  }

  // 验证并修正每道题
  questions = questions.map((q) => ({
    type: q.type || "single",
    stem: q.stem || "",
    options: Array.isArray(q.options) ? q.options : [],
    answer: Array.isArray(q.answer) ? q.answer : [],
    analysis: q.analysis,
    referenceAnswer: q.referenceAnswer,
    score: typeof q.score === "number" ? q.score : q.type === "essay" ? 5 : 1,
    difficulty: q.difficulty || "medium",
  }));

  return { questions };
}
