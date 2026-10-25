#!/usr/bin/env node
/**
 * 本地记忆（简单麦 / Easy Eat · A3）
 *
 * 两个文件，都在 meal-skill/memory/ 下，都在 .gitignore 里，**只在这台机器上**：
 *   profile.json  口味与行为：taste / usual / rejected / budgetBand / byWeekday / recentChoices
 *   health.json   过敏：allergyKnown（unknown|none|known）/ allergens / confirmedAt
 *
 * 用法（在 meal-skill/ 下）：
 *   node scripts/memory.mjs read [--json]
 *   node scripts/memory.mjs update --json '{"mood":"tired"}'        # 只接受白名单字段
 *   node scripts/memory.mjs update --json '{"allergyKnown":"none"}' # 自动写 health.json
 *   node scripts/memory.mjs clear            # 清两个文件
 *   node scripts/memory.mjs clear --target health   # 只清过敏记录，口味保留
 *
 * 安全：
 *   - 不存也不接受：姓名、电话、地址、addressId、订单号；
 *   - 不发任何网络请求（JEV 永远拿不到这些内容）；
 *   - 写文件用 临时文件 + rename，避免写一半把记忆写坏。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MEMORY_DIR = path.resolve(HERE, '..', 'memory');
const PROFILE_PATH = path.join(MEMORY_DIR, 'profile.json');
const HEALTH_PATH = path.join(MEMORY_DIR, 'health.json');

const PROFILE_KEYS = ['taste', 'usual', 'rejected', 'budgetBand', 'byWeekday', 'recentChoices'];
const HEALTH_KEYS = ['allergyKnown', 'allergens', 'confirmedAt'];
const ALLERGY_STATES = ['unknown', 'none', 'known'];

/** 这些键一旦出现就拒绝（哪怕是嵌套的）。 */
const FORBIDDEN_KEYS = [
  'name',
  'contactname',
  'phone',
  'mobile',
  'tel',
  'address',
  'fulladdress',
  'addressid',
  'orderid',
  'orderno',
  'latitude',
  'longitude',
];

const EMPTY_PROFILE = {};
const EMPTY_HEALTH = { allergyKnown: 'unknown', allergens: [], confirmedAt: null };

// ---------------------------------------------------------------- 文件

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, file);
}

function readAll() {
  const profile = readJson(PROFILE_PATH, null);
  const health = readJson(HEALTH_PATH, null);
  return {
    profile: profile || { ...EMPTY_PROFILE },
    health: health || { ...EMPTY_HEALTH },
    files: {
      profile: fs.existsSync(PROFILE_PATH),
      health: fs.existsSync(HEALTH_PATH),
    },
  };
}

// ---------------------------------------------------------------- 校验

/** 本地时区 ISO（带 +08:00 这类偏移），方便人看。 */
function isoLocal(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const hours = pad(Math.floor(Math.abs(offset) / 60));
  const minutes = pad(Math.abs(offset) % 60);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${sign}${hours}:${minutes}`
  );
}

function assertNoForbiddenKeys(value, trail = '') {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.includes(String(key).toLowerCase())) {
      throw new Error(`拒绝写入：字段「${trail}${key}」属于个人/位置信息，记忆里不允许保存`);
    }
    assertNoForbiddenKeys(child, `${trail}${key}.`);
  }
}

function splitPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('--json 需要是一个对象');
  }
  assertNoForbiddenKeys(payload);

  const profilePatch = {};
  const healthPatch = {};
  const unknown = [];

  for (const [key, value] of Object.entries(payload)) {
    if (PROFILE_KEYS.includes(key)) profilePatch[key] = value;
    else if (HEALTH_KEYS.includes(key)) healthPatch[key] = value;
    else unknown.push(key);
  }

  if (unknown.length) {
    throw new Error(`未知字段：${unknown.join('、')}。可用：${[...PROFILE_KEYS, ...HEALTH_KEYS].join('、')}`);
  }
  return { profilePatch, healthPatch };
}

function validateHealth(next) {
  if (!ALLERGY_STATES.includes(next.allergyKnown)) {
    throw new Error(`allergyKnown 只能是 ${ALLERGY_STATES.join(' / ')}，收到：${next.allergyKnown}`);
  }
  if (!Array.isArray(next.allergens)) throw new Error('allergens 必须是数组');
  if (next.allergyKnown === 'known' && next.allergens.length === 0) {
    throw new Error('allergyKnown=known 时 allergens 不能为空；不确定就记 unknown');
  }
  if (next.allergyKnown !== 'known' && next.allergens.length > 0) {
    throw new Error('allergens 只在 allergyKnown=known 时填写');
  }
}

// ---------------------------------------------------------------- 命令

function cmdRead(options) {
  const state = readAll();
  if (options.json) {
    console.log(JSON.stringify(state, null, 2));
    return 0;
  }
  console.log(`目录：${MEMORY_DIR}`);
  console.log(`profile.json：${state.files.profile ? '有' : '无'}  ${JSON.stringify(state.profile)}`);
  console.log(
    `health.json：${state.files.health ? '有' : '无'}  allergyKnown=${state.health.allergyKnown}` +
      (state.health.allergens.length ? `  allergens=${state.health.allergens.length} 项` : '  allergens=[]') +
      `  confirmedAt=${state.health.confirmedAt || 'null'}`,
  );
  return 0;
}

function cmdUpdate(options) {
  if (!options.json) {
    console.error("用法：node scripts/memory.mjs update --json '{\"usual\":[\"板烧鸡腿堡\"]}'");
    return 2;
  }
  let payload;
  try {
    payload = JSON.parse(String(options.json));
  } catch {
    console.error('--json 不是合法 JSON');
    return 2;
  }

  let patches;
  try {
    patches = splitPayload(payload);
  } catch (err) {
    console.error(err.message);
    return 2;
  }

  const state = readAll();
  const wrote = [];

  if (Object.keys(patches.profilePatch).length) {
    const nextProfile = { ...state.profile, ...patches.profilePatch };
    writeAtomic(PROFILE_PATH, nextProfile);
    wrote.push('profile');
  }

  if (Object.keys(patches.healthPatch).length) {
    const nextHealth = { ...state.health, ...patches.healthPatch };
    if (!nextHealth.allergens) nextHealth.allergens = [];
    if (!('confirmedAt' in patches.healthPatch) && nextHealth.allergyKnown !== 'unknown') {
      nextHealth.confirmedAt = isoLocal();
    }
    try {
      validateHealth(nextHealth);
    } catch (err) {
      console.error(err.message);
      return 2;
    }
    writeAtomic(HEALTH_PATH, nextHealth);
    wrote.push('health');
  }

  if (!wrote.length) {
    console.error('没有可写字段');
    return 2;
  }

  console.log(JSON.stringify({ ok: true, wrote, state: readAll() }, null, 2));
  return 0;
}

function cmdClear(options) {
  const target = String(options.target || 'all');
  if (!['all', 'profile', 'health'].includes(target)) {
    console.error('--target 只能是 all / profile / health');
    return 2;
  }

  const removed = [];
  if (target === 'all' || target === 'health') {
    if (fs.existsSync(HEALTH_PATH)) {
      fs.unlinkSync(HEALTH_PATH);
      removed.push('health');
    }
  }
  if (target === 'all' || target === 'profile') {
    if (fs.existsSync(PROFILE_PATH)) {
      fs.unlinkSync(PROFILE_PATH);
      removed.push('profile');
    }
  }

  console.log(JSON.stringify({ ok: true, removed, remaining: readAll().files }, null, 2));
  return 0;
}

function main() {
  const [command = '', ...rest] = process.argv.slice(2);
  const options = {};
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = rest[i + 1];
    if (next === undefined || next.startsWith('--')) options[key] = true;
    else {
      options[key] = next;
      i += 1;
    }
  }

  if (command === 'read') return cmdRead(options);
  if (command === 'update') return cmdUpdate(options);
  if (command === 'clear') return cmdClear(options);

  console.error(
    [
      '用法：node scripts/memory.mjs <read|update|clear> [参数]',
      '  read                          # 看两个文件现在有什么',
      '  update --json \'{"usual":["板烧鸡腿堡"]}\'',
      '  update --json \'{"allergyKnown":"none"}\'   # 自动写 health.json',
      '  clear                         # 清空 profile + health',
      '  clear --target health         # 只清过敏记录',
    ].join('\n'),
  );
  return 2;
}

try {
  process.exitCode = main();
} catch (err) {
  console.error(`[memory] ${err.message}`);
  process.exitCode = 1;
}
