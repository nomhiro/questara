'use strict';

const VALID_KEYS = ['A', 'B', 'C', 'D'];

/** 問題文の比較用正規化（空白除去 + 小文字化） */
function normalizeText(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, '');
}

/**
 * 1問を検証し、不正なら除外理由（文字列）を返す。正常なら null。
 */
function checkQuestion(q, seen) {
  if (!q || typeof q.question !== 'string' || q.question.trim().length < 10) return '問題文が短すぎる';
  const optionKeys = Object.keys(q.options || {});
  if (optionKeys.length !== 4 || VALID_KEYS.some((k) => !optionKeys.includes(k))) return '選択肢が A〜D の4つではない';
  if (VALID_KEYS.some((k) => !String(q.options[k] || '').trim())) return '空の選択肢がある';
  const texts = VALID_KEYS.map((k) => normalizeText(q.options[k]));
  if (new Set(texts).size !== 4) return '選択肢のテキストが重複している';
  const answers = Array.isArray(q.correctAnswers) && q.correctAnswers.length > 0
    ? q.correctAnswers
    : (q.correctAnswer ? [q.correctAnswer] : []);
  if (answers.length === 0 || answers.some((a) => !VALID_KEYS.includes(a))) return '正解キーが不正';
  if (q.type === 'multiple' && answers.length < 2) return 'multiple なのに正解が1つ';
  if (q.type !== 'multiple' && answers.length > 1) return 'single なのに正解が複数';
  if (typeof q.explanation !== 'string' || q.explanation.trim().length < 20) return '解説が不足（20文字以上必要）';
  if (seen.has(normalizeText(q.question))) return '既存問題と重複';
  return null;
}

/**
 * LLM が生成した問題の機械検証。不正な問題を除外し、
 * { valid, rejected: [{ question, reason }] } を返す。
 * existingQuestions（既存の問題配列）との重複もここで弾く。
 */
function validateQuestions(questions, { existingQuestions = [] } = {}) {
  const valid = [];
  const rejected = [];
  const seen = new Set(existingQuestions.map((q) => normalizeText(q.question)));

  for (const q of questions || []) {
    const reason = checkQuestion(q, seen);
    if (reason) {
      rejected.push({ question: q, reason });
    } else {
      seen.add(normalizeText(q.question));
      valid.push(q);
    }
  }
  return { valid, rejected };
}

module.exports = { validateQuestions };
