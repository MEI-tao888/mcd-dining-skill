/**
 * turn.mjs：对话回合的唯一本地入口（薄编排，不含新规则）
 *
 * 把 belief.mjs（听懂）和 voice.mjs（说话）接进主链路，只有两个动作：
 *   ask     用户说完一句话 → 合并状态 → 给出"这一句该问什么"或"可以去查候选了"
 *   reveal  揭晓前 → 把要发的话交进来 → 返回"真正能发的那句"
 *
 * 纯本地：不联网、不调 LLM、不写文件。state 只在调用方手里往返（含过敏原，不落盘）。
 *
 * 用法（输入一律是一个 JSON，走 --input-json 或 stdin）：
 *   node scripts/turn.mjs ask    --input-json '{"say":"好累，不想动","state":<上轮 state，首轮省略>,"hints":{"mood":"tired"}}'
 *   node scripts/turn.mjs reveal --input-json '{"reply":"<要发的话>","state":<state>,"decision":{"store":"..","meal":"..","priceYuan":"¥35.00","quote":".."},"attempt":1}'
 *
 * 退出码：0 可以继续 / 可以发；1 reveal 违规要求重写（attempt=1）；3 不许揭晓（过敏没问 / 兜底也拼不出）。
 *
 * 代码级保证（模型调用本脚本的前提下，脚本自己说了算）：
 *   - 过敏没问过 → ask 只返回过敏那一问，reveal 直接 blocked；
 *   - 每次 ask 最多 1 个问题，且问句由脚本给出，字段不重复问；
 *   - reveal 只会返回过 voice 检查、价格与 decision 一致、且按规则带（或不重复带）过敏提醒的话；
 *   - 重写一次仍违规 → 由 safeReply 拼事实；拼不出 → 不揭晓。
 * 只能靠提示词的：模型是否每回合都调用本脚本、是否原样发送 reply / send。
 */

import { fileURLToPath } from 'node:url';
import {
  createState, mergeTurn, applyHints, evaluate, commitQuestion, markWarned, toJudgeBelief, toCandidatesArgs,
} from './belief.mjs';
import { checkReply, safeReply, hasAllergyWarning } from './voice.mjs';
import { readHealth } from './allergen.mjs';
import { toneOf } from './signals.mjs';

const parseYuan = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : null;
};

const allergyGateOpen = (state) => state.fields.allergyKnown.value === 'unknown' && !state.session.askedAllergy;

/**
 * 问句的语气随 tone 变（过敏那一问仍然必问，只是说法变短）：
 *   impatient  先认一句，只留问句，不再解释隐私
 *   quiet      放轻，只留问句
 *   curt / normal  正常
 */
function composeQuestion(q, tone) {
  if (q.field !== 'allergyKnown') return q.text;
  if (tone === 'impatient') return `行，不绕了，就一个事：${q.text}`;
  if (tone === 'quiet') return `就问一句：${q.text}`;
  return `${q.preface ?? ''}${q.text}`;
}

/** ask：合并这一句（和模型读出的软信号），返回要问的那一句或"可以查候选"。 */
export function ask(input = {}, { health } = {}) {
  const base = input.state ?? createState({ health });

  // “换”是控制指令，不是新需求：不能重新抽状态、不能重新问口味/过敏。
  if (/^\s*(换(一个|一份)?|换个|不要这个)[。！!，,]*\s*$/.test(String(input.say ?? ''))) {
    return {
      action: 'swap',
      readiness: 'swap',
      reply: null,
      state: base,
      missing: [],
      defaulted: [],
      confidence: base ? 1 : 0,
      ignoredHints: [],
      candidatesArgs: base ? toCandidatesArgs(base) : null,
      judgeBelief: base ? toJudgeBelief(base) : null,
    };
  }

  let state = mergeTurn(base, String(input.say ?? ''));
  const { state: hinted, ignored } = applyHints(state, input.hints);
  state = hinted;

  const result = evaluate(state);
  const tone = toneOf(state);
  const reply = result.nextQuestion ? composeQuestion(result.nextQuestion, tone) : null;
  const committed = commitQuestion(state, result.nextQuestion);

  return {
    action: result.readiness === 'ready' ? 'proceed' : 'ask',
    readiness: result.readiness,
    reply, // 要问就原样发这一句；null 表示这回合不问，去查候选
    state: committed,
    missing: result.missing,
    defaulted: result.defaulted,
    confidence: result.confidence,
    ignoredHints: ignored,
    tone, // normal | impatient | quiet | curt：给模型调整语气用，不进 judgeBelief
    toneReasons: state.signals?.reasons ?? [],
    // 以下只在 proceed 时有意义：喂给 candidates.mjs / judge.mjs 的参数
    candidatesArgs: toCandidatesArgs(committed),
    judgeBelief: toJudgeBelief(committed),
  };
}

/** reveal：决定"真正发出去的那句话"。 */
export function reveal(input = {}) {
  const state = input.state;
  if (!state?.fields) return { action: 'error', send: null, reason: 'reveal 需要 ask 返回的 state', exitCode: 2 };
  const attempt = Number(input.attempt) >= 2 ? 2 : 1;
  const decision = input.decision ?? {};
  const reply = String(input.reply ?? '');

  if (allergyGateOpen(state)) {
    return { action: 'blocked', send: null, reason: '过敏还没问过，先问，不许揭晓', state, exitCode: 3 };
  }

  const needWarn = state.fields.allergyKnown.value === 'unknown' && !state.session.warnedAllergy;
  const violations = [...checkReply(reply, state).violations];

  const price = parseYuan(decision.priceYuan);
  if (price !== null) {
    const allowed = [price, ...(Array.isArray(decision.allowedYuan) ? decision.allowedYuan.map(parseYuan) : [])];
    for (const m of reply.matchAll(/¥\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:块钱|块|元)/g)) {
      const n = Number(m[1] ?? m[2]);
      if (!allowed.some((a) => a !== null && Math.abs(a - n) < 0.005)) {
        violations.push({ id: 'price-mismatch', severity: 'high', msg: `回复里的金额 ${n} 和算价结果 ${price} 对不上` });
      }
    }
  }
  if (needWarn && !hasAllergyWarning(reply)) {
    violations.push({ id: 'missing-allergy-warning', severity: 'high', msg: '过敏状态未知，揭晓要带一次提醒' });
  }

  if (violations.length === 0) {
    const next = hasAllergyWarning(reply) ? markWarned(state) : state;
    return { action: 'send', via: 'model', send: reply, state: next, violations: [], exitCode: 0 };
  }
  if (attempt === 1) {
    return { action: 'rewrite', send: null, violations, state, exitCode: 1 };
  }

  const safe = safeReply({ ...decision, priceYuan: price, warnAllergy: needWarn });
  if (safe === null) {
    return { action: 'withhold', send: null, violations, reason: '兜底也拼不出（缺店 / 套餐 / 价格），不揭晓', state, exitCode: 3 };
  }
  return { action: 'send', via: 'safe', send: safe, state: needWarn ? markWarned(state) : state, violations, exitCode: 0 };
}

// ---------- CLI ----------

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) { out._.push(argv[i]); continue; }
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i += 1; }
  }
  return out;
}

async function readStdin() {
  if (process.stdin.isTTY) return '';
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const command = options._[0];
  if (!['ask', 'reveal'].includes(command)) {
    console.error('用法：node scripts/turn.mjs ask|reveal [--input-json <json>]（或从 stdin 传 JSON）');
    return 2;
  }
  let input;
  try {
    const raw = typeof options['input-json'] === 'string' ? options['input-json'] : await readStdin();
    input = JSON.parse(raw || '{}');
  } catch {
    console.error('输入不是合法 JSON');
    return 2;
  }
  if (command === 'ask') {
    const result = ask(input, { health: input.state ? undefined : readHealth() });
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }
  const { exitCode, ...result } = reveal(input);
  console.log(JSON.stringify(result, null, 2));
  return exitCode;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().then((code) => { process.exitCode = code; }).catch((err) => { console.error(err.message); process.exitCode = 2; });
}
