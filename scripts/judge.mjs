#!/usr/bin/env node
/**
 * JEV 裁判（简单麦 / Easy Eat · A3）
 *
 * 只做一件事：在**已经过滤好**的 2–3 组候选里，选一组"最合此刻"的。
 * 不生成候选、不改价、不改候选。
 *
 * ⚠️ 线上必须 `provider === "jev"` 才允许揭晓（A6）。
 *    这里的 `provider="fallback"` 只是**离线自测/排障**用的算术兜底，不是推荐：
 *    判断服务不可用时，聊天层应**不给方案**，而不是拿 fallback 的 chosenId 顶上。
 *
 * 用法（在 meal-skill/ 下）：
 *   node scripts/judge.mjs --health
 *   node scripts/judge.mjs --candidates data/candidates.json --belief belief.json
 *   node scripts/judge.mjs --candidates data/candidates.json --belief-json '{"mood":"low"}'
 *
 * 退出码（A6.1，**默认就是严格模式**，没有开关）：
 *   0  provider === "jev"，`recommended=true`，可以揭晓
 *   2  拿不到 JEV 判断（低置信 / violates_hard / choice_not_found / no_key /
 *      network / 451 …）→ `recommended=false`、`chosenId=null`，**不许揭晓**
 *   --allow-fallback 只给离线自测/排障：输出 fallback 的 chosenId 并 exit 0，
 *   线上任何调用都**不要**带这个开关。
 * 配置（都可以用环境变量覆盖）：
 *   JEVMODEL_API_KEY   key；缺省读 %USERPROFILE%\.jevmodel\api_key.txt
 *   JEV_PROXY          代理，默认 http://127.0.0.1:7897；设为 off/空 则不代理
 *   JEV_MODEL          默认 jev-latest
 *   JEV_ENDPOINT       默认 https://jevmodel.org/v1/systemone
 *   JEV_TIMEOUT_MS     默认 8000
 *
 * 安全：
 *   - key 只读不打印，错误信息里也会被抹掉；
 *   - 发给 JEV 的 state 只含：对话摘要 + 候选（id/type/餐品/价格/说明），
 *     **不含 allergens、health.json、地址、电话、addressRef**。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const DEFAULT_ENDPOINT = 'https://jevmodel.org/v1/systemone';
const DEFAULT_MODEL = 'jev-latest';
const DEFAULT_PROXY = 'http://127.0.0.1:7897';
const DEFAULT_TIMEOUT_MS = 8000;
const CONFIDENCE_MIN = 0.55;
const VIOLATES_MAX = 0.5;
const SCORE_LEVELS = ['完全不贴合', '勉强', '还行', '很贴合'];

// ---------------------------------------------------------------- 配置

function readKey() {
  const fromEnv = (process.env.JEVMODEL_API_KEY || '').trim();
  if (fromEnv) return fromEnv;
  const file = path.join(os.homedir(), '.jevmodel', 'api_key.txt');
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    return '';
  }
}

function resolveProxy() {
  if (!('JEV_PROXY' in process.env)) return DEFAULT_PROXY;
  const value = String(process.env.JEV_PROXY || '').trim();
  if (!value || /^(off|none|direct|0)$/i.test(value)) return '';
  return value;
}

const CONFIG = {
  endpoint: process.env.JEV_ENDPOINT || DEFAULT_ENDPOINT,
  model: process.env.JEV_MODEL || DEFAULT_MODEL,
  proxy: resolveProxy(),
  timeoutMs: Number(process.env.JEV_TIMEOUT_MS || DEFAULT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
};

/** 抹掉 key，避免错误信息把 key 带出来。 */
function scrub(text, key) {
  let out = String(text ?? '');
  if (key) out = out.split(key).join('<key-hidden>');
  out = out.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer <key-hidden>');
  return out;
}

// ---------------------------------------------------------------- 代理（只影响本进程）

/**
 * Node 默认忽略 HTTP_PROXY；这里用 --use-env-proxy 重新拉起自己。
 * 只有 judge 子进程拿到代理变量，MCP/其他脚本仍然直连。
 */
function maybeReexecWithProxy() {
  if (!CONFIG.proxy) return;
  if (process.env.JEV_PROXY_REEXEC === '1') return;
  if (process.execArgv.some((arg) => arg.includes('use-env-proxy'))) return;

  // 老版本 Node 没有这个开关：直接原地跑（大概率 451 → 回退），不报错。
  const probe = spawnSync(process.execPath, ['--use-env-proxy', '-e', '0'], { stdio: 'ignore' });
  if (probe.status !== 0) return;

  const env = {
    ...process.env,
    HTTP_PROXY: CONFIG.proxy,
    HTTPS_PROXY: CONFIG.proxy,
    http_proxy: CONFIG.proxy,
    https_proxy: CONFIG.proxy,
    NO_PROXY: process.env.NO_PROXY || '127.0.0.1,localhost',
    no_proxy: process.env.no_proxy || '127.0.0.1,localhost',
    JEV_PROXY_REEXEC: '1',
  };
  const child = spawnSync(
    process.execPath,
    ['--no-warnings', '--use-env-proxy', process.argv[1], ...process.argv.slice(2)],
    { stdio: 'inherit', env },
  );
  if (child.error) return;
  process.exit(child.status ?? 1);
}

// ---------------------------------------------------------------- HTTP

class JevError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status ?? null;
  }
}

async function postJev(body, key) {
  let response;
  try {
    response = await fetch(CONFIG.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(CONFIG.timeoutMs),
    });
  } catch (err) {
    const name = err?.name || '';
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new JevError('timeout', `请求超时（${CONFIG.timeoutMs}ms）`);
    }
    throw new JevError('network', scrub(err.message, key));
  }

  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const upstream = payload?.error?.upstream?.status;
    const code =
      response.status === 451 || upstream === 451
        ? 'http_451'
        : response.status === 401
          ? 'http_401'
          : response.status === 429
            ? 'http_429'
            : `http_${response.status}`;
    const message =
      payload?.error?.upstream?.title || payload?.error?.message || scrub(text.slice(0, 200), key);
    throw new JevError(code, message, response.status);
  }

  if (!payload || !payload.answers) throw new JevError('bad_response', '返回里没有 answers');
  return payload;
}

/** 一次业务请求，失败重试 1 次（超时/网络/5xx）；4xx 不重试。 */
async function requestWithRetry(body, key) {
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const payload = await postJev(body, key);
      return { payload, attempts: attempt };
    } catch (err) {
      lastError = err;
      const retriable = ['timeout', 'network', 'bad_response'].includes(err.code) || /^http_5/.test(err.code);
      if (!retriable || attempt === 2) break;
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------- 入参

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) options[key] = true;
    else {
      options[key] = next;
      i += 1;
    }
  }
  return options;
}

function readJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  } catch (err) {
    throw new Error(`读不了 ${file}：${err.message}`);
  }
}

/** belief 既支持扁平 {mood:'low'}，也支持 {mood:{value:'low'}}。 */
function unwrapBelief(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  const source = raw.belief && typeof raw.belief === 'object' ? raw.belief : raw;
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if ('value' in value) out[key] = value.value;
    } else {
      out[key] = value;
    }
  }
  return out;
}

const yuan = (cents) =>
  typeof cents === 'number' && Number.isFinite(cents) ? `¥${(cents / 100).toFixed(2)}` : '—';

/** JEV 的问题名/选项名只接受短标识符（字母、数字、下划线）。 */
function safeKey(id) {
  const cleaned = String(id).replace(/[^A-Za-z0-9_]/g, '_');
  return /^[0-9]/.test(cleaned) ? `c_${cleaned}` : cleaned;
}

function candidateLine(candidate) {
  const items = (candidate.items || [])
    .map((item) => `${item.name}×${item.quantity}`)
    .join(' + ');
  const price = candidate.price?.totalYuan || yuan(candidate.price?.totalCents);
  const why = candidate.typeNote || '';
  return { id: String(candidate.id), key: safeKey(candidate.id), type: String(candidate.type), items, price, why };
}

// ---- quotes 外发过滤（P0-3）-------------------------------------------------
// quotes 是用户原话，会原样发往境外的 JEV 服务。含过敏/健康、地址/门牌、电话/邮箱的
// 句子整句丢弃（不做"打码后再发"：正则打码不可靠，丢掉只损失一点软信号）。
// 宁可多丢：误丢一句"软信号"没有代价，漏发一句过敏/地址有。
const QUOTE_BLOCK_RULES = [
  {
    reason: 'health',
    // 过敏/忌口/病史/用药/孕期等健康信息
    re: /过敏|忌口|不耐受?|乳糖|麸质|哮喘|糖尿|血糖|高血压|痛风|心脏|肾|肝|胃病|孕|哺乳|医生|医嘱|药|手术|病|禁食|不能吃|不可以吃|吃不了|不敢吃|碰不得|不能碰/,
  },
  {
    reason: 'health',
    // 常见过敏原词 + 否定/忌讳语境（只有"想吃鱼"不丢，"鱼不能吃"丢）
    re: /(花生|坚果|牛奶|鸡蛋|大豆|芝麻|小麦|海鲜|虾|蟹|鱼|麸质).{0,6}(不能|不可以|不敢|不行|碰不|吃不了|忌|禁|敏)|(不能|不可以|不敢|碰不|吃不了|忌|禁).{0,6}(花生|坚果|牛奶|鸡蛋|大豆|芝麻|小麦|海鲜|虾|蟹|鱼|麸质)/,
  },
  {
    reason: 'phone',
    // 11 位手机号、带分隔的手机号、任意 7 位以上连续数字（含空格/横线分隔）、邮箱
    re: /1[3-9]\d[\s-]?\d{4}[\s-]?\d{4}|\d[\d\s-]{6,}\d|[\w.+-]+@[\w-]+\.[\w.]+/,
  },
  {
    reason: 'address',
    // 门牌/楼栋/房号、"XX路/街/大道"、以及地址语境词
    // 不单独匹配"某某路/街"：会误伤"不想走路"这类有用的软信号；路名带门牌号时由数字规则兜住。
    re: /[0-9一二三四五六七八九十百零]+\s*(号|栋|幢|座|单元|室|楼|层|弄|巷|路|街)|地址|住址|门牌|家住|我住|住在|送到|收货|小区|公寓|宿舍/,
  },
];

const QUOTE_MAX_ITEMS = 4;
const QUOTE_MAX_CHARS = 60;

/** 返回 { kept: string[], dropped: [{reason}] }；dropped 不含原文。 */
function sanitizeQuotes(quotes) {
  const kept = [];
  const dropped = [];
  if (!Array.isArray(quotes)) return { kept, dropped };
  for (const raw of quotes) {
    if (typeof raw !== 'string') continue;
    const text = raw.trim();
    if (!text) continue;
    const hit = QUOTE_BLOCK_RULES.find((rule) => rule.re.test(text));
    if (hit) {
      dropped.push({ reason: hit.reason });
      continue;
    }
    if (kept.length < QUOTE_MAX_ITEMS) kept.push(text.slice(0, QUOTE_MAX_CHARS));
  }
  return { kept, dropped };
}

/**
 * 只把"能公开"的东西拼进 state：
 * 对话摘要（软信号）+ 过滤后的 quotes + 候选（id/type/餐品/价格/说明）。
 * 明确不写：allergens、health.json、地址、电话、addressRef；
 * quotes 里含过敏/健康、地址/门牌、电话/邮箱的句子整句丢弃（见 sanitizeQuotes）。
 */
function buildState(belief, candidates) {
  const soft = {
    mood: belief.mood ?? null,
    fullness: belief.fullness ?? null,
    taste: belief.taste ?? null,
    timePressure: belief.timePressure ?? null,
    novelty: belief.novelty ?? null,
  };
  return {
    task: '在已经通过硬性约束的 2–3 组麦当劳套餐里，选出最贴合此刻状态的一组。',
    now: new Date().toISOString(),
    people: belief.people ?? null,
    budgetYuan: typeof belief.budgetCents === 'number' ? (belief.budgetCents / 100).toFixed(2) : null,
    mode: belief.mode ?? null,
    user: soft,
    quotes: sanitizeQuotes(belief.quotes).kept,
    candidates: candidates,
  };
}

function buildQuestions(candidates) {
  const criteria = {};
  for (const candidate of candidates) {
    criteria[candidate.key] = `${candidate.type}：${candidate.items}，${candidate.price}`;
  }

  const questions = {
    pick: {
      type: 'choice',
      instructions:
        '哪一组最适合这个人现在的状态？判断依据：赶时间、想吃得轻一点、下午还要干活 → 轻；' +
        '累、情绪低、想被安慰 → 稳妥；心情好、想犒劳自己、有人一起吃 → 奖励；' +
        '两组都贴得上时选更稳的那组。只能从这些候选里选。',
      criteria,
    },
    violates_hard: {
      type: 'noul',
      instructions: '这些候选里被选中的那组，是否违反了用户明确表达的硬性限制（预算、人数、取餐方式、不能吃的东西）？',
    },
  };

  for (const candidate of candidates) {
    questions[`fit_${candidate.key}`] = {
      type: 'score',
      instructions: `这一组（${candidate.type}：${candidate.items}，${candidate.price}）有多贴合这个人现在的状态？`,
      criteria: SCORE_LEVELS,
    };
  }
  return questions;
}

// ---------------------------------------------------------------- 决策

function mapByBelief(belief, candidates) {
  const mood = String(belief.mood || '');
  const fullness = String(belief.fullness || '');
  const pressure = String(belief.timePressure || '');

  let wanted = '稳妥';
  if (mood === 'low' || mood === 'tired') wanted = '稳妥';
  else if (pressure === 'high' || fullness === 'light') wanted = '轻';
  else if (mood === 'high') wanted = '奖励';

  const hit = candidates.find((candidate) => candidate.type === wanted) || null;
  return {
    chosen: hit || candidates[0] || null,
    wanted,
    matched: Boolean(hit),
  };
}

function decide({ enabled, payload, candidates, belief, fallbackReason, model, latencyMs, attempts }) {
  const base = {
    enabled,
    provider: enabled ? 'jev' : 'fallback',
    chosenId: null,
    chosenType: null,
    confidence: null,
    fits: {},
    violatesHard: null,
    usage: payload?.usage || null,
    fallbackReason: fallbackReason || null,
    model: payload?.model || model || null,
    latencyMs: latencyMs ?? null,
    attempts: attempts ?? null,
  };

  const fallback = (reason) => {
    const mapped = mapByBelief(belief, candidates);
    return {
      ...base,
      provider: 'fallback',
      chosenId: mapped.chosen ? String(mapped.chosen.id) : null,
      chosenType: mapped.chosen ? String(mapped.chosen.type) : null,
      confidence: null,
      fallbackReason: reason,
    };
  };

  if (!candidates.length) return fallback('no_candidates');
  if (!enabled || !payload) return fallback(fallbackReason || 'disabled');

  const answers = payload.answers || {};
  const pick = answers.pick || null;
  const violates = typeof answers.violates_hard?.noul === 'number' ? answers.violates_hard.noul : null;
  const confidence = typeof pick?.confidence === 'number' ? pick.confidence : null;
  const chosen = candidates.find((candidate) => candidate.key === String(pick?.choice)) || null;

  const fits = {};
  for (const candidate of candidates) {
    const key = `fit_${candidate.key}`;
    if (typeof answers[key]?.score === 'number') fits[candidate.id] = answers[key].score;
  }

  if (!chosen) return { ...fallback('choice_not_found'), fits, violatesHard: violates, confidence };
  if (confidence === null) return { ...fallback('no_confidence'), fits, violatesHard: violates };
  if (violates !== null && violates >= VIOLATES_MAX) {
    return { ...fallback('violates_hard'), fits, violatesHard: violates, confidence };
  }
  if (confidence < CONFIDENCE_MIN) {
    return { ...fallback('low_confidence'), fits, violatesHard: violates, confidence };
  }

  return {
    ...base,
    provider: 'jev',
    chosenId: String(chosen.id),
    chosenType: String(chosen.type),
    confidence,
    fits,
    violatesHard: violates,
    fallbackReason: null,
  };
}

// ---------------------------------------------------------------- 命令

async function runHealth(key) {
  const startedAt = Date.now();
  const body = {
    model: CONFIG.model,
    state: 'health check',
    questions: {
      alive: { type: 'noul', instructions: '返回一个 0 到 1 之间的概率，表示这次健康检查是否被正确理解。' },
    },
  };

  let result;
  try {
    const payload = await postJev(body, key);
    result = {
      enabled: true,
      provider: 'jev',
      model: payload.model || CONFIG.model,
      latencyMs: Date.now() - startedAt,
      usage: payload.usage || null,
      noul: payload.answers?.alive?.noul ?? null,
      proxy: CONFIG.proxy || '(direct)',
      reason: null,
    };
  } catch (err) {
    result = {
      enabled: false,
      provider: 'fallback',
      model: CONFIG.model,
      latencyMs: Date.now() - startedAt,
      usage: null,
      noul: null,
      proxy: CONFIG.proxy || '(direct)',
      reason: { code: err.code || 'error', message: scrub(err.message, key) },
    };
  }

  console.log(JSON.stringify(result, null, 2));
  return 0; // 健康检查永远 exit 0
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const key = readKey();

  if (options.health) {
    if (!key) {
      console.log(
        JSON.stringify(
          {
            enabled: false,
            provider: 'fallback',
            reason: { code: 'no_key', message: '没有 JEVMODEL_API_KEY，也没有 ~/.jevmodel/api_key.txt' },
            proxy: CONFIG.proxy || '(direct)',
          },
          null,
          2,
        ),
      );
      return 0;
    }
    if (CONFIG.proxy) maybeReexecWithProxy();
    return runHealth(key);
  }

  if (!options.candidates) {
    console.error(
      '用法：node scripts/judge.mjs --candidates <candidates.json> [--belief <file>|--belief-json <json>] [--out <file>] [--allow-fallback]',
    );
    console.error('      node scripts/judge.mjs --health');
    return 2;
  }

  const candidatesJson = readJsonFile(options.candidates);
  const rawCandidates = Array.isArray(candidatesJson.candidates) ? candidatesJson.candidates : [];
  const candidates = rawCandidates.slice(0, 3).map(candidateLine);

  let belief = {};
  if (options['belief-json']) {
    try {
      belief = unwrapBelief(JSON.parse(String(options['belief-json'])));
    } catch {
      console.error('--belief-json 不是合法 JSON');
      return 2;
    }
  } else if (options.belief) {
    belief = unwrapBelief(readJsonFile(options.belief));
  }
  belief.mode = belief.mode ?? candidatesJson.fulfillment?.effectiveMode ?? candidatesJson.summary?.mode ?? null;
  belief.people = belief.people ?? candidatesJson.request?.people ?? null;
  if (belief.budgetCents == null) belief.budgetCents = candidatesJson.request?.budgetCents ?? null;

  let decision;
  if (!key) {
    decision = decide({ enabled: false, payload: null, candidates, belief, fallbackReason: 'no_key' });
  } else {
    if (CONFIG.proxy) maybeReexecWithProxy();

    const body = {
      model: CONFIG.model,
      state: JSON.stringify(buildState(belief, candidates)),
      questions: buildQuestions(candidates),
    };

    // 只打请求体（不含 key），用于核对"state 里到底发了什么"。
    if (options['dry-run']) {
      console.log(JSON.stringify(body, null, 2));
      return 0;
    }

    const startedAt = Date.now();
    try {
      const { payload, attempts } = await requestWithRetry(body, key);
      decision = decide({
        enabled: true,
        payload,
        candidates,
        belief,
        model: CONFIG.model,
        latencyMs: Date.now() - startedAt,
        attempts,
      });
    } catch (err) {
      decision = decide({
        enabled: false,
        payload: null,
        candidates,
        belief,
        fallbackReason: err.code || 'error',
        model: CONFIG.model,
        latencyMs: Date.now() - startedAt,
        attempts: 2,
      });
      decision.error = { code: err.code || 'error', message: scrub(err.message, key) };
    }
  }

  // ---- 硬门槛（A6.1）------------------------------------------------------
  // 默认就是"要求 JEV"：provider !== "jev" 一律不推荐，chosenId 抹成 null，exit 2。
  // --allow-fallback 才回到旧行为（离线自测/排障用），exit 0。
  const strict = !options['allow-fallback'];

  if (strict && decision.provider !== 'jev') {
    decision.recommended = false;
    decision.strict = true;
    decision.chosenId = null;
    decision.chosenType = null;
    // confidence / fits / violatesHard / fallbackReason / error 都留着，方便排障，但**不能当推荐用**
  } else {
    decision.recommended = decision.provider === 'jev';
    decision.strict = strict;
    // 排障模式：exit 0 让调用方拿到一份可看的 fallback，但它永远不是"推荐"
    decision.debugOnly = decision.provider !== 'jev';
  }

  if (options.out) {
    const outPath = path.resolve(String(options.out));
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${JSON.stringify(decision, null, 2)}\n`, 'utf8');
  }

  console.log(JSON.stringify(decision, null, 2));
  return strict && !decision.recommended ? 2 : 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    console.error(`[judge] ${err.message}`);
    process.exitCode = 1;
  });
