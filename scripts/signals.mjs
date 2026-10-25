/**
 * signals.mjs：从"他怎么说"（而不是"他说了什么"）里读情绪苗头
 *
 * 纯本地、确定性，不调 LLM，不落盘。只在 state.signals 里往返，含：
 *   recent  最近 6 句的特征：{ k: 归一化后的短哈希, n: 去标点后字数, end: 句末写法 }
 *           不存原话。哈希只用来判断"是不是又说了同一句"。
 *   tone    normal | impatient | quiet | curt
 *   reasons 触发原因的名字（repeat / complaint / bang / period-shift / ellipsis / energy-drop / shortened / curt）
 *
 * 能读到的（都只是苗头，不是诊断）：
 *   - 同一句话（忽略标点和语气词）重复出现，或带"我说了 / 都说了"这类埋怨 → impatient
 *   - 前面几句都没打句号，这一句突然打了 "。" 或 "…"；或前面带感叹号，现在突然没了 → quiet
 *   - 前面说得长，这一句突然只剩几个字（且不是在回答我的问题）→ quiet
 *   - 连着两句都只有一两个字 → curt
 *
 * 做不到的（诚实写在这里）：
 *   - 跨会话的"他平时从不打句号"：零落盘隐私立场下没有历史，基线只来自本会话已有的 ≥3 句。
 *   - 阈值没有在真实用户上验证过，是经验值。
 *   - 不判断语义（讽刺、玩笑会误判）。误判的代价被设计成很小：只影响语气和"少问"，不影响推荐、价格、过敏闸门。
 */

import { createHash } from 'node:crypto';

const KEEP = 6;
const PARTICLES = /[啊呀吧嘛呢哦嗯啦了哈哎诶欸噢]/g;
const NOT_WORD = /[\s\p{P}\p{S}]/gu;
const COMPLAINT = /我(都)?说(过|了)|都说了|说了多少遍|跟你说过|听不懂|怎么又|又问|还问/;

const hash = (text) => createHash('sha1').update(text).digest('hex').slice(0, 8);

/** 一句话 → 只留特征，不留原文。 */
export function featurize(text) {
  const raw = String(text ?? '').trim();
  const plain = raw.replace(NOT_WORD, '');
  const loose = plain.replace(PARTICLES, '');
  let end = 'none';
  if (/(\.{2,}|…+|。{2,})$/.test(raw)) end = 'ellipsis';
  else if (/[!！]{2,}$/.test(raw)) end = 'bang2';
  else if (/[!！]$/.test(raw)) end = 'bang';
  else if (/[。.]$/.test(raw)) end = 'period';
  else if (/[?？]$/.test(raw)) end = 'question';
  return { k: loose.length >= 2 ? hash(loose) : null, n: plain.length, end, complaint: COMPLAINT.test(raw) };
}

const EMPTY = { recent: [], tone: 'normal', reasons: [] };

export function analyze(recent, cur, { answering = null } = {}) {
  const reasons = [];
  const lastFour = recent.slice(-4);

  // 1 重复 / 埋怨 → 不耐烦
  const repeats = cur.k ? lastFour.filter((r) => r.k === cur.k).length : 0;
  if (repeats >= 2) reasons.push('repeat');
  else if (repeats === 1 && (cur.complaint || cur.end === 'bang' || cur.end === 'bang2')) reasons.push('repeat');
  if (cur.complaint) reasons.push('complaint');
  if (cur.end === 'bang2' && cur.n >= 2 && lastFour.some((r) => r.end !== 'bang2')) reasons.push('bang');
  if (reasons.length) return { tone: 'impatient', reasons };

  // 2 低落苗头：句末写法相对本会话基线突变（基线至少 3 句有效消息）
  const base = recent.filter((r) => r.n >= 2).slice(-5);
  if (base.length >= 3 && cur.n >= 1) {
    const noPunct = base.every((r) => r.end === 'none' || r.end === 'question');
    if (noPunct && cur.end === 'period') reasons.push('period-shift');
    if (noPunct && cur.end === 'ellipsis') reasons.push('ellipsis');
    const lively = base.filter((r) => r.end === 'bang' || r.end === 'bang2').length >= 2;
    if (lively && (cur.end === 'none' || cur.end === 'period')) reasons.push('energy-drop');
    const avg = base.reduce((s, r) => s + r.n, 0) / base.length;
    if (!answering && avg >= 8 && cur.n <= 3) reasons.push('shortened');
  }
  if (reasons.length) return { tone: 'quiet', reasons };

  // 3 连着两句都只有一两个字
  const prev = recent[recent.length - 1];
  if (prev && prev.n <= 2 && cur.n <= 2 && cur.n >= 1) return { tone: 'curt', reasons: ['curt'] };

  return { tone: 'normal', reasons: [] };
}

/** 把这一句记进 state.signals（返回新 state，不改入参）。 */
export function observe(prev, text) {
  const state = structuredClone(prev);
  const sig = state.signals ?? structuredClone(EMPTY);
  const cur = featurize(text);
  const result = analyze(sig.recent, cur, { answering: state.answering ?? state.pendingQuestion ?? null });
  state.signals = {
    recent: [...sig.recent, { k: cur.k, n: cur.n, end: cur.end }].slice(-KEEP),
    tone: result.tone,
    reasons: result.reasons,
  };
  return state;
}

export const toneOf = (state) => state?.signals?.tone ?? 'normal';
