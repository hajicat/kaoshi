/**
 * 昵称 → 拼音密码转换
 * 使用内置轻量映射表（~20KB），不依赖 pinyin npm 包（8MB+）
 * 覆盖 GB2312 一级常用汉字 + 常见昵称/姓氏用字
 *
 * 规则：
 * - 中文 → 取拼音全拼，小写
 * - 英文/数字 → 原样保留（转小写）
 * - 未识别字符 → 跳过
 * - 结果不足 8 位 → 尾部循环补 "123"
 */

import { PINYIN_MAP } from './pinyin-data'

/**
 * 单字 → 拼音
 */
function charToPinyin(ch: string): string {
  // 英文字母/数字原样返回（字母转小写）
  if (/^[a-zA-Z0-9]$/.test(ch)) return ch.toLowerCase()
  // 查映射表
  return PINYIN_MAP[ch] || ''
}

/**
 * 昵称 → 拼音密码（全小写，无声调，最少8位）
 * 例：
 *   '小明'   → 'xiaoming'   (刚好8位)
 *   '阿强'   → 'aqiang123'  (6位+补2位到8)
 *   'Tom'    → 'tom12345'   (3位+补5位到8)
 *   'Alice'  → 'alice123'   (5位+补3位到8)
 */
export function nicknameToPinyin(nickname: string): string {
  let base = ''
  for (const ch of nickname) {
    base += charToPinyin(ch)
  }
  if (base.length >= 8) return base

  // 不足8位：循环补 "123"
  const suffix = '123'
  const padLen = 8 - base.length
  let result = base
  for (let i = 0; i < padLen; i++) {
    result += suffix[i % suffix.length]
  }
  return result
}
