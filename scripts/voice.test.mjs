import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkReply, safeReply } from './voice.mjs';

const ids = (r) => r.violations.map((v) => v.id);

test('1 「理由：」→ fail', () => {
  const r = checkReply('楼下那家，套餐 ¥34.50。理由：你累了。');
  assert.equal(r.ok, false);
  assert.ok(ids(r).includes('report-label'));
  assert.equal(r.severity, 'high');
});

test('2 推荐理由 / 依据： / 结论： / 参数： / 条件： 都拦', () => {
  for (const t of ['推荐理由：快', '依据：你说的', '结论：吃这个', '参数：x', '条件：y']) {
    assert.equal(checkReply(t).ok, false, t);
  }
});

test('3 一句里两个问号 → fail', () => {
  const r = checkReply('想吃辣的吗？还是清淡的？');
  assert.ok(ids(r).includes('multi-question'));
});

test('4 列表 / 表格 / 标题 → fail', () => {
  assert.ok(ids(checkReply('- 汉堡\n- 小食')).includes('list'));
  assert.ok(ids(checkReply('1. 汉堡\n2. 小食')).includes('list'));
  assert.ok(ids(checkReply('| 店 | 价 |\n| a | 1 |')).includes('table'));
  assert.ok(ids(checkReply('### 推荐')).includes('heading'));
});

test('5 「能选的话」及其他不确定措辞 → fail', () => {
  for (const t of ['能选的话选可乐', '应该可以换', '可能有', '大概十块', '看情况', '一般来说是这样', '理论上能换']) {
    assert.equal(checkReply(t).ok, false, t);
  }
});

test('6 首先/其次/综上/根据你的描述/建议您/为您推荐 → fail', () => {
  for (const t of ['首先看价格', '其次看口味', '最后下单', '综上选这个', '根据你的描述来配', '建议您吃这个', '为您推荐套餐']) {
    assert.equal(checkReply(t).ok, false, t);
  }
});

test('7 无依据细节「热乎的/几分钟/出餐快/吃完不犯困/别等外卖」→ fail', () => {
  for (const t of ['热乎的', '走过去几分钟', '出餐快', '吃完不犯困', '别等外卖']) {
    assert.equal(checkReply(t).ok, false, t);
  }
});

test('8 同会话第二次过敏警告 → fail；第一次 → pass', () => {
  const warn = '配料和交叉接触我看不到，你下单前再确认一下。';
  assert.equal(checkReply(`楼下那家，套餐 ¥28.00。${warn}`, { session: { warnedAllergy: false } }).ok, true);
  const r = checkReply(`换个小的，¥20.00。${warn}`, { session: { warnedAllergy: true } });
  assert.ok(ids(r).includes('repeat-allergy-warning'));
});

test('9 正常可爱的一句话 → pass，不误杀', () => {
  const samples = [
    '楼下那家，“堡”你欢乐套餐，¥28.00。你说别太撑，我就挑了小一点的。不合适你说换。',
    '你都饿成狗了，按最能填肚子的配。¥34.50，不合适你说换。',
    '想吃扎实点，还是吃完还能干活？',
    '有没有不能碰的（过敏那种）？',
    '行，我换一份。',
  ];
  for (const t of samples) {
    const r = checkReply(t, { session: { warnedAllergy: true } });
    assert.equal(r.ok, true, `${t} -> ${JSON.stringify(r.violations)}`);
    assert.equal(r.severity, 'none');
  }
});

test('10 把名字核对说成安全 → fail', () => {
  for (const t of ['这份安全', '你可以放心吃', '已经帮你确认过没有花生', '不含花生过敏原']) {
    assert.equal(checkReply(t).ok, false, t);
  }
});

test('11 问卷腔「请提供/请选择/请确认」→ fail', () => {
  for (const t of ['请提供你的预算', '请选择口味', '请确认过敏原']) assert.equal(checkReply(t).ok, false, t);
});

test('12 safeReply：只拼事实，自身通过 checkReply，缺事实返回 null', () => {
  const reply = safeReply({ store: '楼下那家', meal: '“堡”你欢乐套餐', priceYuan: 28, quote: '别太撑' });
  assert.match(reply, /楼下那家/);
  assert.match(reply, /¥28\.00/);
  assert.match(reply, /别太撑/);
  assert.equal(checkReply(reply).ok, true);
  assert.equal(safeReply({ store: '楼下那家', meal: '套餐' }), null);
  assert.equal(safeReply({ meal: '套餐', priceYuan: 10 }), null);
});

test('13 safeReply：敏感原话不引用；需要过敏警告时带一次且自身合规；不引入新事实', () => {
  const r = safeReply({ store: '楼下那家', meal: '套餐', priceYuan: 20, quote: '我花生过敏，累死了', warnAllergy: true });
  assert.doesNotMatch(r, /花生|累死/);
  assert.match(r, /交叉接触/);
  assert.equal(checkReply(r).ok, true);
  const again = safeReply({ store: '楼下那家', meal: '套餐', priceYuan: 20 });
  assert.doesNotMatch(again, /热乎|分钟|出餐|安全/);
});
