/**
 * 详情阶段的过敏原"菜名级"核对（P0-4）
 *
 * 能做的：把用户已知的过敏原，和 query-meal-detail 返回的**文字**逐项比对——
 *   商品名、套餐每一轮的名称和**全部**可选项、可加减料的组名和**全部**选项。
 * 做不到的：配料表、酱料成分、交叉接触。接口里没有这些，所以**永远不输出"安全"**。
 *
 * 状态（status）：
 *   unknown-not-scanned   过敏状态未知：没法核对，也不能当成"没有"
 *   none-not-scanned      用户说没有：无需核对
 *   conflict-fixed        固定部分（商品名 / 不能换的一轮 / 一轮的所有选项）命中 → 换一组
 *   conflict-swappable    只有可换的一轮里的部分选项命中 → 避开这些选项，或换一组
 *   hit-addon-only        只有"可加减料"命中 → 不要推荐加这些料
 *   no-hit-name-only      已知过敏原，菜名/选项名没命中；**仅此而已**，不等于安全
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HEALTH_PATH = path.resolve(HERE, '..', 'memory', 'health.json');

export const NAME_ONLY_NOTE =
  '只核对了菜名和选项名；配料表、酱料成分、交叉接触这里看不到，不构成安全保证，请下单前自行确认。';

const norm = (text) => String(text ?? '').replace(/\s+/g, '').toLowerCase();

/** 读本机 health.json；读不到 / 坏了 → unknown（unknown ≠ none）。 */
export function readHealth(file = HEALTH_PATH) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const state = ['none', 'known', 'unknown'].includes(raw.allergyKnown) ? raw.allergyKnown : 'unknown';
    const allergens = Array.isArray(raw.allergens)
      ? raw.allergens.map((item) => String(item).trim()).filter(Boolean)
      : [];
    if (state === 'known' && allergens.length === 0) return { allergyKnown: 'unknown', allergens: [] };
    return { allergyKnown: state, allergens: state === 'known' ? allergens : [] };
  } catch {
    return { allergyKnown: 'unknown', allergens: [] };
  }
}

function matchTerms(text, terms) {
  const haystack = norm(text);
  return terms.filter((term) => haystack.includes(norm(term)));
}

/**
 * @param {object} data   query-meal-detail 的 data（要用**未截断**的原始结构）
 * @param {{allergyKnown:string, allergens:string[]}} health
 */
export function scanAllergens(data, health) {
  const base = { allergyKnown: health.allergyKnown, allergens: health.allergens, scope: 'dish-names-only' };

  if (health.allergyKnown === 'unknown') {
    return {
      ...base,
      status: 'unknown-not-scanned',
      hits: [],
      statement: '你的过敏情况我不确定，所以这份没法核对；配料和交叉接触我也看不到，下单前请自己确认。',
    };
  }
  if (health.allergyKnown === 'none') {
    return { ...base, status: 'none-not-scanned', hits: [], statement: NAME_ONLY_NOTE };
  }

  const terms = health.allergens;
  const hits = [];
  const add = (kind, where, name, matched) => hits.push({ kind, where, name, allergens: matched });

  // 1) 商品名
  const mainMatched = matchTerms(data?.name, terms);
  if (mainMatched.length) add('fixed', '商品名', String(data.name), mainMatched);

  // 2) 套餐每一轮：用全部 choices，不要截断
  const rounds = Object.values(data?.rounds || {}).filter((round) => round && typeof round === 'object');
  for (const round of rounds) {
    const choices = (round.choices || []).map((choice) => String(choice?.name ?? '')).filter(Boolean);
    const roundName = String(round.name || choices[0] || '一项');
    if (choices.length <= 1) {
      const matched = matchTerms(`${round.name ?? ''}${choices[0] ?? ''}`, terms);
      if (matched.length) add('fixed', roundName, choices[0] || roundName, matched);
      continue;
    }
    const hitChoices = choices
      .map((name) => ({ name, matched: matchTerms(name, terms) }))
      .filter((entry) => entry.matched.length);
    if (hitChoices.length === choices.length) {
      for (const entry of hitChoices) add('fixed', roundName, entry.name, entry.matched);
    } else {
      for (const entry of hitChoices) add('swappable', roundName, entry.name, entry.matched);
    }
  }

  // 3) 可加减料：组名 + 全部选项
  const groups = (data?.modification && data.modification.items) || [];
  for (const group of groups) {
    const groupName = String(group?.name || '加减料');
    for (const value of group?.values || []) {
      const name = String(value?.name ?? '');
      const matched = matchTerms(`${groupName}${name}`, terms);
      if (name && matched.length) add('addon', groupName, name, matched);
    }
  }

  const has = (kind) => hits.some((hit) => hit.kind === kind);
  if (has('fixed')) {
    return {
      ...base,
      status: 'conflict-fixed',
      hits,
      statement: `这组里有「${hits.find((h) => h.kind === 'fixed').name}」，和你的忌口冲突，不给你这组，换一组。`,
    };
  }
  if (has('swappable')) {
    const names = hits.filter((h) => h.kind === 'swappable').map((h) => h.name);
    return {
      ...base,
      status: 'conflict-swappable',
      hits,
      statement: `这组里「${names.join('、')}」和你的忌口冲突；要么避开这几个选项，要么换一组。${NAME_ONLY_NOTE}`,
    };
  }
  if (has('addon')) {
    return {
      ...base,
      status: 'hit-addon-only',
      hits,
      statement: `可加的料里有和你忌口冲突的，不要推荐加。${NAME_ONLY_NOTE}`,
    };
  }
  return { ...base, status: 'no-hit-name-only', hits, statement: NAME_ONLY_NOTE };
}
