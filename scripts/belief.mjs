/**
 * belief.mjs：把"猜中"变成可验证的状态，而不是模型自由发挥
 *
 * 只做三件事：合并这一句话 → 判断能不能揭晓 → 最多给出 1 个要问的问题。
 * 纯本地、不联网、不调用 LLM、不写文件；不改价格 / 券 / JEV 门槛 / 过敏决策。
 *
 * 用法（CLI，状态由调用方带回来，脚本自己不落盘）：
 *   node scripts/belief.mjs --say "好累，不想动" [--state-json '<上一轮 state>'] [--health]
 *   echo '{"say":"...","state":{...}}' | node scripts/belief.mjs --stdin
 *   输出 JSON：{ state, readiness, missing, defaulted, nextQuestion, confidence }
 *   readiness: blocked（过敏没问过，不许揭晓）| ask（可以再问 1 句）| ready（可以进候选）
 *   输出的 nextQuestion 视为"你下一句就会问它"，已记入 state.pendingQuestion，下一轮带回来即可。
 *
 * 隐私：state 里只存抽取出来的字段，不存用户原话；含 allergens / location，
 *       所以 **不要把 state 整体交给 judge.mjs / JEV**。
 */

import { readHealth } from './allergen.mjs';

import { observe, toneOf } from './signals.mjs';

// ---------- 常量 ----------

/** 这些字段只能由用户亲口说出来，不许 inferred。 */
const USER_ONLY = new Set(['mode', 'allergyKnown', 'allergens']);
const RANK = { default: 0, inferred: 1, user_said: 2 };
const SOFT = ['mood', 'fullness', 'timePressure', 'taste'];

/** 信息增益（越大越先问）：会改变候选集合的排前面。mood / location 不问。 */
const GAIN = { allergyKnown: 1.0, fullness: 0.7, taste: 0.5, timePressure: 0.4 };
const MAX_SOFT_QUESTIONS = 2;

export const QUESTIONS = {
  allergyKnown: {
    preface: '这个我只记在你自己电脑上，之后就不用每次问你了，想删随时说。',
    text: '有没有不能碰的（过敏那种）？',
  },
  // 软问题写成"带着默认方向的确认"，不是干巴巴的选项
  fullness: { text: '我先往扎实点配，一会儿还要干活的话，就收轻一点，行吗？' },
  taste: { text: '我先按不辣的来，你要是想来点辣的，说一声？' },
  timePressure: { text: '赶时间的话我挑拿了就走的，是吗？' },
};

const CN_NUM = { 一: 1, 二: 2, 两: 2, 俩: 2, 三: 3, 仨: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

// ---------- 状态 ----------

function field(value, confidence, source, turn = 0) {
  return { value, confidence, source, turn };
}

export function createState({ health } = {}) {
  const state = {
    turn: 0,
    fields: {
      mode: field('pickup', 0.6, 'default'),
      people: field(1, 0.5, 'default'),
      budget: field(null, 0.3, 'default'),
      avoid: field([], 0.5, 'default'),
      allergyKnown: field('unknown', 0, 'default'),
      allergens: field([], 0, 'default'),
      mood: field(null, 0, 'default'),
      fullness: field(null, 0, 'default'),
      timePressure: field(null, 0, 'default'),
      taste: field(null, 0, 'default'),
      location: field(null, 0, 'default'),
    },
    // 会话标记：只活在这一次会话里，不落盘
    session: { askedAllergy: false, warnedAllergy: false, storeMentioned: false },
    asked: {}, // 字段 → 本会话问过几次
    pendingQuestion: null, // 上一句我问了哪个字段
    prevTurnAsked: false, // 上一轮是不是在提问（用于"不连续追问"）
    answering: null, // 这一句话是在回答哪个问题
    skipSoft: false, // 用户说了"随便/你定"，软字段不再问
  };
  // 本机 health.json 是用户以前亲口说的：none / known 直接沿用（unknown 保持 unknown）
  if (health?.allergyKnown === 'none') applyAllergy(state, 'none', []);
  if (health?.allergyKnown === 'known' && health.allergens?.length) applyAllergy(state, 'known', health.allergens);
  return state;
}

/**
 * 写一个字段（会改动传入的 state）。
 * - mode / 过敏只接受 user_said（初始化的 default 除外）
 * - 低来源不能覆盖高来源；同级或更高来源后写者胜（最新 user_said 为准）
 */
export function setField(state, name, value, confidence, source) {
  const cur = state.fields[name];
  if (!cur) return { ok: false, reason: 'unknown-field' };
  if (!(source in RANK)) return { ok: false, reason: 'bad-source' };
  if (USER_ONLY.has(name) && source !== 'user_said') return { ok: false, reason: 'user-only' };
  if (RANK[source] < RANK[cur.source]) return { ok: false, reason: 'lower-source' };
  state.fields[name] = field(value, confidence, source, state.turn);
  return { ok: true };
}

function applyAllergy(state, kind, list) {
  if (kind === 'none') {
    setField(state, 'allergyKnown', 'none', 0.9, 'user_said');
    setField(state, 'allergens', [], 0.9, 'user_said');
    return;
  }
  const merged = [...new Set([...(state.fields.allergens.value || []), ...list])];
  setField(state, 'allergyKnown', 'known', 0.9, 'user_said');
  setField(state, 'allergens', merged, 0.9, 'user_said');
}

// ---------- 抽取（只做关键词，宁可漏不要错） ----------

const RE = {
  pickup: /(不要|不用|别|不想)(送|外送|外卖)|自取|自己(去)?(拿|取|过去|买)|到店|我去拿|下楼(拿|取|买|吃)|堂食|店里吃/,
  delivery: /送到|送过来|送来|送我|帮我送|给我送|外卖|外送|配送|叫个外卖|点个外卖/,
  unsure: /不清楚|不确定|不知道|应该(没|不)|好像|可能|大概|说不好|吧[？?]?\s*$/,
  none: /(不|没|无)过敏|没有(过敏|忌口)|都能吃|什么都吃|没什么忌口|无忌口|没忌口/,
  bareNone: /^[\s，,。.!！~]*(没有的?|没得|没|无|没事|不过敏)[\s，,。.!！~啦呀哦哈]*$/,
  skipSoft: /随便|你定|都行|都可以|看你|无所谓|你决定/,
};

function extractAllergens(text) {
  const out = new Set();
  const junk = /^(食物|东西|什么|很多|一些|有些)$/;
  let idx = text.indexOf('过敏');
  while (idx >= 0) {
    const before = text.slice(Math.max(0, idx - 8), idx);
    if (!/[不没无]有?$/.test(before)) {
      const seg = before.split(/[，,。.！!？?；;\s]/).pop() || '';
      const cleaned = seg
        .replace(/^(对了|其实|就是|哦|嗯|那|不过|但是)+/, '')
        .replace(/^[我对是有就还也]+/, '')
        .replace(/(有点|有些|很|特别|严重|轻微|比较|会)+$/, '');
      for (const part of cleaned.split(/[、和及与跟]/)) {
        const term = part.trim();
        if (term.length >= 1 && term.length <= 4 && !junk.test(term)) out.add(term);
      }
    }
    idx = text.indexOf('过敏', idx + 2);
  }
  for (const m of text.matchAll(/(?:不能吃|不可以吃|碰不了)([\u4e00-\u9fa5]{1,4})/g)) {
    const term = m[1].replace(/[的了吧啊呀哦呢]+$/, '');
    if (term && !junk.test(term)) out.add(term);
  }
  return [...out];
}

function extractAvoid(text) {
  const out = new Set();
  const bad = /[问我你送说想管催]/;
  for (const m of text.matchAll(/(?:不吃|不要|别放|不想吃|不爱吃|忌口)([\u4e00-\u9fa5]{1,4})/g)) {
    let raw = m[1].replace(/[的了吧啊呀哦呢]+$/, '').replace(/^[太放要点]+/, '');
    for (const part of raw.split(/[和及与跟]/)) {
      const term = part.trim();
      if (term && !bad.test(term) && term !== '外卖') out.add(term);
    }
  }
  return [...out];
}

function extractPeople(text) {
  let m = text.match(/(?:我们|咱们|咱)(俩|仨)/);
  if (m) return CN_NUM[m[1]];
  m = text.match(/(俩|仨)人/);
  if (m) return CN_NUM[m[1]];
  m = text.match(/([一二两三四五六七八九十]|\d{1,2})\s*个?人/);
  if (m) {
    const n = CN_NUM[m[1]] ?? Number(m[1]);
    if (n >= 1 && n <= 20) return n;
  }
  return null;
}

function extractBudget(text) {
  let m = text.match(/(?:预算|不超过|最多|控制在|别超过)\D{0,3}(\d{2,4})/);
  if (!m) m = text.match(/(\d{2,4})\s*(?:块钱|块|元)?\s*(?:以内|以下|之内|封顶|左右)/);
  return m ? Number(m[1]) : null;
}

/** 从一句话里抽字段。返回 { hits: [{name,value,confidence}], allergy, skipSoft } */
export function extractSignals(text, { answering = null } = {}) {
  const t = String(text ?? '');
  const hits = [];
  const add = (name, value, confidence) => hits.push({ name, value, confidence });

  if (RE.pickup.test(t)) add('mode', 'pickup', 0.9);
  else if (RE.delivery.test(t)) add('mode', 'delivery', 0.9);

  const people = extractPeople(t);
  if (people) add('people', people, 0.9);
  const budget = extractBudget(t);
  if (budget) add('budget', budget, 0.9);

  const avoid = extractAvoid(t);
  if (avoid.length) add('avoid', avoid, 0.9);

  // 过敏：含糊永远是 unknown；明确说"没有"才是 none
  let allergy = null;
  const known = extractAllergens(t);
  if (RE.unsure.test(t)) allergy = null;
  else if (known.length) allergy = { kind: 'known', list: known };
  else if (RE.none.test(t) || (answering === 'allergyKnown' && RE.bareNone.test(t))) allergy = { kind: 'none', list: [] };

  // 软字段
  if (/累|困|没劲|不想动|加班|熬夜|疲/.test(t)) add('mood', 'tired', 0.8);
  else if (/烦|丧|难受|emo/i.test(t)) add('mood', 'low', 0.7);
  else if (/开心|庆祝|奖励自己/.test(t)) add('mood', 'happy', 0.7);

  if (/轻(点|一点|食)|少吃|不想吃太多|别太撑|不要太撑|没胃口|不太饿|不饿/.test(t)) add('fullness', 'light', 0.7);
  else if (/饿(死|坏|成狗|极|得)|很饿|好饿|超饿|特别饿|饿了|扎实|吃饱|管饱/.test(t)) add('fullness', 'big', 0.7);

  if (/不急|慢慢|有的是时间|不赶/.test(t)) add('timePressure', 'low', 0.8);
  else if (/赶|快点|来不及|马上|急|十分钟|\d+分钟(后|内)|开会/.test(t)) add('timePressure', 'high', 0.8);

  if (!avoid.some((term) => term.includes('辣')) && /想吃辣|吃辣|来点辣|重口|够味|麻辣/.test(t)) add('taste', 'spicy', 0.7);
  else if (/清淡/.test(t)) add('taste', 'light', 0.7);
  else if (/想吃甜|来点甜/.test(t)) add('taste', 'sweet', 0.7);

  // 位置只记粗粒度标签，不记门牌/地址
  const loc = t.match(/在(公司|家里?|学校|宿舍|办公室|工位)/);
  if (loc) add('location', loc[1] === '家里' ? '家' : loc[1], 0.6);

  return { hits, allergy, skipSoft: RE.skipSoft.test(t) };
}

// ---------- 合并 ----------

/**
 * 合并用户这一句话，返回新 state（不改入参）。原话不进 state。
 */
export function mergeTurn(prev, text) {
  const state = structuredClone(prev);
  state.turn += 1;
  state.answering = state.pendingQuestion;
  state.prevTurnAsked = state.pendingQuestion !== null;
  state.pendingQuestion = null;

  const { hits, allergy, skipSoft } = extractSignals(text, { answering: state.answering });
  for (const hit of hits) {
    if (hit.name === 'avoid') {
      const merged = [...new Set([...(state.fields.avoid.value || []), ...hit.value])];
      setField(state, 'avoid', merged, hit.confidence, 'user_said');
    } else {
      setField(state, hit.name, hit.value, hit.confidence, 'user_said');
    }
  }
  if (allergy) applyAllergy(state, allergy.kind, allergy.list);
  if (skipSoft) state.skipSoft = true;
  return observe(state, text); // 记"他怎么说"的特征（不存原话），得出 state.signals.tone
}

// ---------- 模型的理解（hints）与下游输出 ----------

/** 模型读懂了语气但关键词没抓到的软信号。只收软字段 + 固定枚举，来源记 inferred。 */
const HINT_ENUM = {
  mood: ['tired', 'low', 'happy', 'neutral'],
  fullness: ['light', 'big', 'normal'],
  timePressure: ['high', 'low'],
  taste: ['spicy', 'light', 'sweet', 'savory'],
};

/**
 * 合并模型给的软信号。mode / 过敏 / 人数 / 预算 / 偏好排除不接受 hint（只认用户亲口说）；
 * inferred 不能覆盖 user_said。返回 { state, ignored }。
 */
export function applyHints(prev, hints) {
  const state = structuredClone(prev);
  const ignored = [];
  for (const [name, value] of Object.entries(hints && typeof hints === 'object' ? hints : {})) {
    if (!HINT_ENUM[name]?.includes(value)) ignored.push(name);
    else if (!setField(state, name, value, 0.6, 'inferred').ok) ignored.push(name);
  }
  return { state, ignored };
}

/**
 * 给 judge.mjs --belief-json 的扁平软信号。故意不含 mode / people / budget（judge 自己从 candidates.json
 * 取，避免外送回退成到店后两边对不上），也不含过敏原 / 地址 / 原话。
 */
export function toJudgeBelief(state) {
  const out = {};
  for (const name of SOFT) {
    const f = state.fields[name];
    if (f.value === null || f.source === 'default') continue;
    out[name] = name === 'mood' && f.value === 'happy' ? 'high' : f.value; // judge 里"奖励"对应 mood=high
  }
  return out;
}

/** 给 candidates.mjs 的参数（城市 / 地标 / 门店由调用方补）。预算单位：元。 */
export function toCandidatesArgs(state) {
  const f = state.fields;
  const args = ['--mode', f.mode.value, '--people', String(f.people.value)];
  if (f.budget.value !== null) args.push('--budget', String(f.budget.value));
  if (f.avoid.value.length) args.push('--avoid', f.avoid.value.join(','));
  return args;
}

// ---------- 提问 ----------

const allergyGate = (state) => state.fields.allergyKnown.value === 'unknown' && !state.session.askedAllergy;

function softKnownCount(state) {
  return SOFT.filter((name) => {
    const f = state.fields[name];
    return f.value !== null && f.source !== 'default' && f.confidence >= 0.5;
  }).length;
}

/**
 * 下一个要问的问题：最多 1 个，没有就是 null。
 * 过敏闸门最优先；软字段按信息增益排序，且满足：
 *   不是用户说了"随便" / 上一轮不是提问 / 软字段还不够 2 个 / 本会话软问题没超 2 个 / 这个字段没问过
 */
export function nextQuestion(state) {
  if (allergyGate(state)) return { field: 'allergyKnown', ...QUESTIONS.allergyKnown };

  if (state.skipSoft || state.prevTurnAsked) return null;
  // 他在不耐烦 / 低落 / 惜字如金：不再追问口味，直接按默认走（过敏闸门不受影响，上面已处理）
  if (toneOf(state) !== 'normal') return null;
  if (softKnownCount(state) >= 2) return null;
  const softAsked = Object.entries(state.asked).filter(([name]) => name !== 'allergyKnown').reduce((n, [, c]) => n + c, 0);
  if (softAsked >= MAX_SOFT_QUESTIONS) return null;

  const candidates = Object.keys(GAIN)
    .filter((name) => name !== 'allergyKnown')
    .filter((name) => state.fields[name].value === null && !state.asked[name])
    .sort((a, b) => GAIN[b] - GAIN[a]);
  return candidates.length ? { field: candidates[0], ...QUESTIONS[candidates[0]] } : null;
}

/** 记下"我这一句问了它"（返回新 state）。同一字段本会话不再问。 */
export function commitQuestion(prev, question) {
  if (!question) return prev;
  const state = structuredClone(prev);
  state.pendingQuestion = question.field;
  state.asked[question.field] = (state.asked[question.field] || 0) + 1;
  if (question.field === 'allergyKnown') state.session.askedAllergy = true;
  return state;
}

/** 揭晓时说了那句过敏警告后调用，之后 voice 会拦截重复警告。 */
export function markWarned(prev) {
  const state = structuredClone(prev);
  state.session.warnedAllergy = true;
  return state;
}

// ---------- 汇总 ----------

export function evaluate(state) {
  const question = nextQuestion(state);
  const missing = allergyGate(state) ? ['allergyKnown'] : [];
  const defaulted = ['mode', 'people', 'budget'].filter((name) => state.fields[name].source === 'default');

  let readiness = 'ready';
  if (missing.length) readiness = 'blocked';
  else if (question) readiness = 'ask';

  const top = SOFT.map((name) => state.fields[name])
    .filter((f) => f.value !== null && f.source !== 'default')
    .map((f) => f.confidence)
    .sort((a, b) => b - a)
    .slice(0, 2);
  const confidence = Math.round(((top[0] || 0) + (top[1] || 0)) * 50) / 100;

  return { state, readiness, missing, defaulted, nextQuestion: question, confidence };
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

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  let say = options.say === true ? '' : options.say;
  let stateJson = options['state-json'];
  if (options.stdin) {
    const input = JSON.parse(await readStdin());
    say = input.say ?? say;
    stateJson = input.state ? JSON.stringify(input.state) : stateJson;
  }
  if (say === undefined) {
    console.error('用法：node scripts/belief.mjs --say "<用户这句话>" [--state-json <上一轮 state>] [--health]');
    return 2;
  }
  let state = stateJson ? JSON.parse(stateJson) : createState({ health: options.health ? readHealth() : undefined });
  state = mergeTurn(state, say);
  const result = evaluate(state);
  const committed = commitQuestion(state, result.nextQuestion);
  console.log(JSON.stringify({ ...result, state: committed }, null, 2));
  return 0;
}

import { fileURLToPath } from 'node:url';
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().then((code) => { process.exitCode = code; }).catch((err) => { console.error(err.message); process.exitCode = 2; });
}
