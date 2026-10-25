// 运行：node --test scripts/allergen.test.mjs
// 夹具是按 query-meal-detail 的结构手写的（rounds 是对象、choices[].name、modification.items[].values[].name），
// 不是真实返回；真实调用需要 MCD_MCP_TOKEN，见 workbuddy.md 12.6 的"未验证"说明。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanAllergens, readHealth, NAME_ONLY_NOTE } from './allergen.mjs';

const known = (...allergens) => ({ allergyKnown: 'known', allergens });
const choice = (name) => ({ name });

test('unknown：不核对、不说安全', () => {
  const r = scanAllergens({ name: '汉堡' }, { allergyKnown: 'unknown', allergens: [] });
  assert.equal(r.status, 'unknown-not-scanned');
  assert.ok(!/安全|放心/.test(r.statement));
  assert.match(r.statement, /不确定/);
});

test('商品名命中 → conflict-fixed，让用户换组', () => {
  const r = scanAllergens({ name: '花生酱鸡腿堡' }, known('花生'));
  assert.equal(r.status, 'conflict-fixed');
  assert.match(r.statement, /换一组/);
});

test('固定的一轮（只有一个选项）命中 → conflict-fixed', () => {
  const data = { name: '套餐', rounds: { a: { name: '主食', choices: [choice('虾堡')] } } };
  assert.equal(scanAllergens(data, known('虾')).status, 'conflict-fixed');
});

test('可换的一轮：只有部分选项命中 → conflict-swappable', () => {
  const data = {
    name: '套餐',
    rounds: { a: { name: '饮料', choices: [choice('可乐'), choice('花生牛奶'), choice('雪碧')] } },
  };
  const r = scanAllergens(data, known('花生'));
  assert.equal(r.status, 'conflict-swappable');
  assert.deepEqual(r.hits.map((h) => h.name), ['花生牛奶']);
});

test('可换的一轮：所有选项都命中 → conflict-fixed', () => {
  const data = { name: '套餐', rounds: { a: { name: '小食', choices: [choice('花生A'), choice('花生B')] } } };
  assert.equal(scanAllergens(data, known('花生')).status, 'conflict-fixed');
});

test('命中在第 6 项以后（详情输出会截断到 5 项）也要被扫到', () => {
  const choices = ['a', 'b', 'c', 'd', 'e', 'f', '花生脆'].map(choice);
  const data = { name: '套餐', rounds: { a: { name: '小食', choices } } };
  const r = scanAllergens(data, known('花生'));
  assert.equal(r.status, 'conflict-swappable');
  assert.equal(r.hits[0].name, '花生脆');
});

test('只有加料命中 → hit-addon-only', () => {
  const data = { name: '汉堡', modification: { items: [{ name: '加料', values: [{ name: '加花生碎' }, { name: '加芝士' }] }] } };
  assert.equal(scanAllergens(data, known('花生')).status, 'hit-addon-only');
});

test('没命中 → no-hit-name-only，且明说只查了菜名，不出现"没有过敏原/放心/安全"', () => {
  const r = scanAllergens({ name: '麦辣鸡腿堡', rounds: {} }, known('花生'));
  assert.equal(r.status, 'no-hit-name-only');
  assert.equal(r.statement, NAME_ONLY_NOTE);
  assert.ok(!/放心|没有过敏原|不含|可以放心|是安全的/.test(r.statement));
  assert.equal(r.scope, 'dish-names-only');
});

test('none → 不核对', () => {
  assert.equal(scanAllergens({ name: '花生堡' }, { allergyKnown: 'none', allergens: [] }).status, 'none-not-scanned');
});

test('readHealth：文件不存在 / 坏 JSON / known 但无过敏原 → unknown', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'allergen-'));
  try {
    assert.equal(readHealth(path.join(dir, 'nope.json')).allergyKnown, 'unknown');
    const bad = path.join(dir, 'bad.json');
    fs.writeFileSync(bad, '{oops');
    assert.equal(readHealth(bad).allergyKnown, 'unknown');
    const empty = path.join(dir, 'empty.json');
    fs.writeFileSync(empty, JSON.stringify({ allergyKnown: 'known', allergens: [] }));
    assert.equal(readHealth(empty).allergyKnown, 'unknown');
    const ok = path.join(dir, 'ok.json');
    fs.writeFileSync(ok, JSON.stringify({ allergyKnown: 'known', allergens: ['花生'] }));
    assert.deepEqual(readHealth(ok), { allergyKnown: 'known', allergens: ['花生'] });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
