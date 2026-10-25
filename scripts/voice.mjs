/**
 * voice.mjs：发送前拦住"报告腔 / 问卷感 / 冒犯 / 不可靠"
 *
 * 纯本地正则，不调用 LLM，不联网，不改任何决策。
 *   checkReply(text, state) → { ok, violations[], severity }   severity: none | low | high
 *   safeReply(decision)     → string | null   只拼事实：店 / 套餐 / 价格 / 一句用户原话
 *
 * CLI：
 *   node scripts/voice.mjs --check "<回复>" [--state-json '<belief state>']   违规 exit 1
 *   node scripts/voice.mjs --safe --decision-json '{"store":"..","meal":"..","priceYuan":34.5,"quote":"..","warnAllergy":false}'
 *
 * 流程：违规 → 让模型重写一次（不新增 LLM 调用类型，就是同一轮对话里重说）→ 仍违规 → safeReply。
 * 这是关键词级的拦截，会漏掉没列出来的说法，也不判断"事实对不对"。
 */

import { fileURLToPath } from 'node:url';

const HIGH = 'high';
const LOW = 'low';

const RULES = [
  { id: 'report-label', severity: HIGH, re: /(推荐理由|理由|依据|结论|参数|条件)\s*[:：]/, msg: '报告腔标签' },
  { id: 'report-connector', severity: HIGH, re: /首先|其次|最后|综上|根据你的描述|根据您的描述|建议您|为您推荐|为你推荐/, msg: '报告腔连接词' },
  { id: 'cute-overload', severity: LOW, re: /亲[~，,！!]|宝子|家人们/, msg: '过度卖萌 / 称呼' },
  { id: 'formal-you', severity: LOW, re: /您/, msg: '客服腔"您"' },
  { id: 'questionnaire', severity: HIGH, re: /请(提供|选择|确认|问)/, msg: '问卷腔' },
  { id: 'hedge', severity: HIGH, re: /能选的话|应该|可能|大概|看情况|一般来说|理论上/, msg: '不确定措辞' },
  { id: 'ungrounded', severity: HIGH, re: /热乎|几分钟|出餐快|吃完不犯困|别等外卖/, msg: '没有数据来源的细节' },
  {
    id: 'safety-claim',
    severity: HIGH,
    re: /这(份|个|组)?(是)?安全|放心(吃|点|下单)|可以放心|已经(帮你)?确认过|不含.{0,6}过敏/,
    msg: '把"只核对了名字"说成安全',
  },
];

const LIST_LINE = /^\s*([-*•·]|\d+[.、)]|[一二三四五六七八九十]+、)\s*\S/m;
const HEADING = /^\s*#{1,6}\s/m;
const TABLE = /^\s*\|.*\|\s*$/m;
const ALLERGY_WARNING = /交叉接触|配料.{0,8}(看不到|确认)|以门店(标注|为准)|过敏.{0,8}(再确认|提醒)/;

/** 这句话里有没有那句过敏提醒（交叉接触 / 配料看不到 / 以门店标注为准）。 */
export const hasAllergyWarning = (text) => ALLERGY_WARNING.test(String(text ?? ''));

export function checkReply(text, state = {}) {
  const s = String(text ?? '');
  const violations = [];
  const add = (id, severity, msg) => violations.push({ id, severity, msg });

  for (const rule of RULES) {
    const m = s.match(rule.re);
    if (m) add(rule.id, rule.severity, `${rule.msg}：「${m[0]}」`);
  }
  if (LIST_LINE.test(s) || /1[.、]\s*\S+[\s\S]*2[.、]\s*\S/.test(s)) add('list', HIGH, '列点');
  if (HEADING.test(s)) add('heading', HIGH, '标题');
  if (TABLE.test(s)) add('table', HIGH, '表格');

  const questions = (s.match(/[？?]/g) || []).length;
  if (questions >= 2) add('multi-question', HIGH, `一条回复里有 ${questions} 个问号`);

  const warned = state?.session?.warnedAllergy ?? state?.warnedAllergyThisSession ?? false;
  if (warned && ALLERGY_WARNING.test(s)) add('repeat-allergy-warning', HIGH, '同一会话重复过敏警告');

  const storeMentioned = state?.session?.storeMentioned ?? state?.storeMentioned;
  if (storeMentioned === false && /还是(楼下|那家|这家)/.test(s)) add('false-familiar', LOW, '"还是"指代没提过的店');

  const severity = violations.some((v) => v.severity === HIGH) ? 'high' : violations.length ? 'low' : 'none';
  return { ok: violations.length === 0, violations, severity };
}

const SENSITIVE_QUOTE = /过敏|忌口|地址|门牌|电话|手机|邮箱|@|\d{6,}/;
const ALLERGY_LINE = '配料和交叉接触我看不到，你下单前再确认一下。';

/**
 * 兜底短模板。decision: { store, meal, priceYuan, quote?, warnAllergy? }
 * 缺店 / 套餐 / 价格任一项就返回 null（调用方应当"不揭晓"，而不是编一个）。
 * 价格必须是 calculate-price 的 totalYuan，这里只做格式化。
 */
export function safeReply(decision = {}) {
  const store = String(decision.store ?? '').trim();
  const meal = String(decision.meal ?? '').trim();
  // 兼容 "¥35.00"（calculate-price 的 totalYuan 原样）和数字
  const price = typeof decision.priceYuan === 'string' ? Number(decision.priceYuan.replace(/[^\d.]/g, '')) : Number(decision.priceYuan);
  if (!store || !meal || decision.priceYuan == null || decision.priceYuan === '' || !Number.isFinite(price)) return null;

  const quote = String(decision.quote ?? '').trim();
  const build = (withQuote) => {
    const parts = [`${store}，${meal}，¥${price.toFixed(2)}。`];
    if (withQuote) parts.push(`你说「${quote}」，就按这个来。`);
    if (decision.warnAllergy) parts.push(ALLERGY_LINE);
    parts.push('不合适你说换。');
    return parts.join('');
  };

  const quoteUsable = quote && quote.length <= 30 && !SENSITIVE_QUOTE.test(quote);
  const withQuote = quoteUsable ? build(true) : null;
  if (withQuote && checkReply(withQuote).ok) return withQuote;
  return build(false);
}

// ---------- CLI ----------

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.safe) {
    const reply = safeReply(JSON.parse(options['decision-json'] || '{}'));
    console.log(JSON.stringify({ ok: reply !== null, reply }));
    return reply === null ? 1 : 0;
  }
  if (typeof options.check === 'string') {
    const state = options['state-json'] ? JSON.parse(options['state-json']) : {};
    const result = checkReply(options.check, state);
    console.log(JSON.stringify(result, null, 2));
    return result.ok ? 0 : 1;
  }
  console.error('用法：node scripts/voice.mjs --check "<回复>" [--state-json <state>] | --safe --decision-json <json>');
  return 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = main();
}
