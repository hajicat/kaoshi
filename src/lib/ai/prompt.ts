// AI 解析题库的提示词模板
// 实际调用时可对接 Workers AI 或外部 AI API

export const PARSE_QUESTION_BANK_PROMPT = `你是一个专业的题目解析助手。请将以下文本内容解析为结构化的题库 JSON 格式。

输出格式要求：
{
  "questions": [
    {
      "type": "single" | "multiple" | "boolean" | "essay",
      "stem": "题目内容",
      "options": [{"key": "A", "text": "选项内容"}, ...],
      "answer": ["A"],  // 正确答案的 key 数组
      "referenceAnswer": "论述题参考答案（仅 essay 类型需要）",
      "analysis": "解析说明",
      "score": 1,
      "tags": ["标签1"],
      "difficulty": "easy" | "medium" | "hard"
    }
  ]
}

规则：
1. 单选题 type=single，答案数组只有一个元素
2. 多选题 type=multiple，答案数组有多个元素
3. 判断题 type=boolean，options 固定为 [{"key":"A","text":"正确"},{"key":"B","text":"错误"}]
4. 论述题 type=essay，options 为空数组，需要提供 referenceAnswer
5. 如果文本中没有明确分值，默认 score=1
6. 请尽量从文本中提取解析/说明`;

export function buildParsePrompt(content: string): string {
  return `${PARSE_QUESTION_BANK_PROMPT}\n\n以下是需要解析的题目文本：\n\n${content}`;
}
