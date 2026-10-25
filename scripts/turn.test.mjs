import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ask, reveal } from './turn.mjs';
import { createState } from './belief.mjs';
import { checkReply } from './voice.mjs';

const UNKNOWN = { allergyKnown: 'unknown', allergens: [] };
const NONE = { allergyKnown: 'none', allergens: [] };
const qCount = (s) => (String(s).match(/[？?]/g) || []).length;
const decision = { store: '楼下那家', meal: '精选单人餐三件套', priceYuan: '¥35.00', quote: '别太撑' };
const WARN = '配料和交叉接触我看不到，你下单前再确认一下。';

// 走一遍 ask，状态原样往返
const askWith = (say, state, extra = {}, health = UNKNOWN) => ask({ say, state, ...extra }, { health });

test('1 「好累，不想动」→ pickup，只问 1 个问题（过敏），不许揭晓', () => {
  const r = askWith('好累，不想动');
  assert.equal(r.state.fields.mode.value, 'pickup');
  assert.equal(r.readiness, 'blocked');
  assert.equal(r.action, 'ask');
  assert.equal(qCount(r.reply), 1);
  assert.match(r.reply, /不能碰的/);
  assert.equal(checkReply(r.reply).ok, true); // 脚本自己给的问句也过 voice
  assert.equal(r.state.session.askedAllergy, true);
});

test('1b 「换」是控制指令：返回 swap，不重新问、不重新抽状态', () => {
  const before = askWith('好累，不想动', undefined, {}, NONE).state;
  const r = ask({ say: '换', state: before });
  assert.equal(r.action, 'swap');
  assert.equal(r.reply, null);
  assert.equal(r.readiness, 'swap');
  assert.deepEqual(r.state.fields, before.fields);
});

test('2 过敏没答 → unknown / blocked；含糊回答仍 unknown 但可继续', () => {
  let r = askWith('午饭吃啥');
  assert.equal(r.state.fields.allergyKnown.value, 'unknown');
  assert.deepEqual(r.missing, ['allergyKnown']);
  r = ask({ say: '应该没事吧', state: r.state });
  assert.equal(r.state.fields.allergyKnown.value, 'unknown');
  assert.notEqual(r.readiness, 'blocked');
});

test('3 逐轮：每轮最多 1 个问题，不连续追问，不重复问同一字段', () => {
  let r = askWith('好累', undefined, {}, NONE);
  const asked = [];
  for (const say of ['嗯', '嗯', '嗯', '嗯']) {
    if (r.reply) asked.push(r.state.pendingQuestion);
    assert.ok(qCount(r.reply) <= 1);
    r = ask({ say, state: r.state });
  }
  assert.equal(new Set(asked).size, asked.length);
  assert.equal(r.reply, null);
  assert.equal(r.action, 'proceed');
});

test('4 hints：模型读出的软信号进 judgeBelief；mode / 过敏类 hint 被忽略', () => {
  const r = ask(
    { say: '没有过敏，随便', state: createState({ health: UNKNOWN }), hints: { mood: 'tired', mode: 'delivery', allergyKnown: 'none', fullness: 'bogus' } },
  );
  assert.equal(r.judgeBelief.mood, 'tired');
  assert.equal(r.state.fields.mode.value, 'pickup');
  assert.deepEqual(r.ignoredHints.sort(), ['allergyKnown', 'fullness', 'mode']);
});

test('5 喂下游：candidatesArgs 带 mode/people/avoid；judgeBelief 不含过敏原 / 原话', () => {
  const r = ask({ say: '我花生过敏，不吃香菜，我们俩，预算50', state: createState({ health: UNKNOWN }) });
  assert.deepEqual(r.candidatesArgs, ['--mode', 'pickup', '--people', '2', '--budget', '50', '--avoid', '香菜']);
  const j = JSON.stringify(r.judgeBelief);
  assert.doesNotMatch(j, /花生|香菜|allerg/);
  assert.ok(!('mode' in r.judgeBelief) && !('people' in r.judgeBelief));
});

test('6 reveal：过敏没问过 → blocked，不给 send', () => {
  const r = reveal({ reply: '楼下那家，¥35.00。', state: createState({ health: UNKNOWN }), decision });
  assert.equal(r.action, 'blocked');
  assert.equal(r.send, null);
  assert.equal(r.exitCode, 3);
});

test('7 reveal：正常回复通过（过敏 none，无需提醒）', () => {
  const state = createState({ health: NONE });
  const r = reveal({ reply: '楼下那家，精选单人餐三件套，¥35.00。你说别太撑，我就挑了小一点的。不合适你说换。', state, decision });
  assert.equal(r.action, 'send');
  assert.equal(r.via, 'model');
  assert.equal(r.exitCode, 0);
});

test('8 reveal：「理由：」/ 两个问号 → 第 1 次要求重写，第 2 次走兜底且兜底合规', () => {
  const state = createState({ health: NONE });
  for (const reply of ['楼下那家，¥35.00。理由：你累了。', '楼下那家，¥35.00，要不要？还是换？']) {
    const a = reveal({ reply, state, decision, attempt: 1 });
    assert.equal(a.action, 'rewrite');
    assert.equal(a.send, null);
    assert.equal(a.exitCode, 1);
    const b = reveal({ reply, state, decision, attempt: 2 });
    assert.equal(b.action, 'send');
    assert.equal(b.via, 'safe');
    assert.match(b.send, /¥35\.00/);
    assert.equal(checkReply(b.send, b.state).ok, true);
  }
});

test('9 reveal：金额和算价结果对不上 → 拦', () => {
  const state = createState({ health: NONE });
  const r = reveal({ reply: '楼下那家，套餐 ¥30.00，不合适你说换。', state, decision });
  assert.equal(r.action, 'rewrite');
  assert.ok(r.violations.some((v) => v.id === 'price-mismatch'));
  const ok = reveal({ reply: '楼下那家，套餐 ¥35.00，省了 ¥5.00。', state, decision: { ...decision, allowedYuan: [5] } });
  assert.equal(ok.action, 'send');
});

test('10 reveal：unknown 且问过 → 首次必须带提醒；带了就记 warned，之后再带被拦', () => {
  let state = ask({ say: '午饭吃啥', state: undefined }, { health: UNKNOWN }).state; // 问过过敏
  state = ask({ say: '应该没事', state }).state;
  const miss = reveal({ reply: '楼下那家，¥35.00。', state, decision });
  assert.equal(miss.action, 'rewrite');
  assert.ok(miss.violations.some((v) => v.id === 'missing-allergy-warning'));

  const first = reveal({ reply: `楼下那家，¥35.00。${WARN}`, state, decision });
  assert.equal(first.action, 'send');
  assert.equal(first.state.session.warnedAllergy, true);

  const again = reveal({ reply: `换个小的，¥28.00。${WARN}`, state: first.state, decision: { ...decision, priceYuan: 28 } });
  assert.equal(again.action, 'rewrite');
  assert.ok(again.violations.some((v) => v.id === 'repeat-allergy-warning'));
  const noWarn = reveal({ reply: '换个小的，¥28.00。', state: first.state, decision: { ...decision, priceYuan: 28 } });
  assert.equal(noWarn.action, 'send');
});

test('11 reveal：兜底 unknown 时自带一次提醒并记 warned；缺价格 → withhold', () => {
  let state = ask({ say: '午饭吃啥' }, { health: UNKNOWN }).state;
  state = ask({ say: '不知道', state }).state;
  const r = reveal({ reply: '理由：累', state, decision, attempt: 2 });
  assert.equal(r.via, 'safe');
  assert.match(r.send, /交叉接触/);
  assert.equal(r.state.session.warnedAllergy, true);
  const w = reveal({ reply: '理由：累', state, decision: { store: '楼下那家', meal: '套餐' }, attempt: 2 });
  assert.equal(w.action, 'withhold');
  assert.equal(w.exitCode, 3);
});

test('12 CLI：stdin / --input-json，退出码正确', () => {
  const script = fileURLToPath(new URL('./turn.mjs', import.meta.url));
  const state = createState({ health: NONE });
  const run = (args, input) => spawnSync(process.execPath, [script, ...args], { input, encoding: 'utf8' });

  const a = run(['ask'], JSON.stringify({ say: '好累，不想动', state }));
  assert.equal(a.status, 0);
  assert.equal(JSON.parse(a.stdout).state.fields.mode.value, 'pickup');

  const bad = run(['reveal', '--input-json', JSON.stringify({ reply: '理由：累', state, decision })]);
  assert.equal(bad.status, 1);
  assert.equal(JSON.parse(bad.stdout).action, 'rewrite');

  const good = run(['reveal'], JSON.stringify({ reply: '楼下那家，¥35.00，不合适你说换。', state, decision }));
  assert.equal(good.status, 0);
  assert.equal(JSON.parse(good.stdout).send, '楼下那家，¥35.00，不合适你说换。');

  assert.equal(run(['nope'], '').status, 2);
});
