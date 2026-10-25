import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState, mergeTurn, nextQuestion, commitQuestion, evaluate, setField, QUESTIONS } from './belief.mjs';

const fresh = () => createState();
// 模拟一轮：合并 → 评估 → 记下问了什么
function turn(state, say) {
  const merged = mergeTurn(state, say);
  const result = evaluate(merged);
  return { ...result, state: commitQuestion(merged, result.nextQuestion) };
}

test('1 没答过敏 → unknown，且不许揭晓，只问过敏一句', () => {
  const r = turn(fresh(), '午饭吃啥');
  assert.equal(r.state.fields.allergyKnown.value, 'unknown');
  assert.equal(r.readiness, 'blocked');
  assert.deepEqual(r.missing, ['allergyKnown']);
  assert.equal(r.nextQuestion.field, 'allergyKnown');
});

test('2 说累但没说送 → pickup（source 是 default，不是 inferred）', () => {
  const r = turn(fresh(), '好累，不想动，不想下楼');
  assert.equal(r.state.fields.mode.value, 'pickup');
  assert.equal(r.state.fields.mode.source, 'default');
  assert.equal(r.state.fields.mood.value, 'tired');
});

test('3 明确说送才是 delivery，且为 user_said', () => {
  const r = turn(fresh(), '帮我叫个外卖吧');
  assert.equal(r.state.fields.mode.value, 'delivery');
  assert.equal(r.state.fields.mode.source, 'user_said');
});

test('4 mode / 过敏不接受 inferred，低来源也不能覆盖 user_said', () => {
  const s = fresh();
  assert.equal(setField(s, 'mode', 'delivery', 0.9, 'inferred').ok, false);
  assert.equal(setField(s, 'allergyKnown', 'none', 0.9, 'inferred').ok, false);
  assert.equal(setField(s, 'allergyKnown', 'none', 0.9, 'default').ok, false);
  assert.equal(s.fields.mode.value, 'pickup');
  assert.equal(s.fields.allergyKnown.value, 'unknown');
  const t = mergeTurn(s, '送过来');
  assert.equal(setField(t, 'mode', 'pickup', 0.9, 'default').ok, false);
  assert.equal(t.fields.mode.value, 'delivery');
});

test('5 预算缺失不阻塞：budget 为 null、来源 default，过敏答完即 ready 或最多问 1 个软问题', () => {
  let r = turn(fresh(), '午饭吃啥');
  r = turn(r.state, '没有');
  assert.equal(r.state.fields.budget.value, null);
  assert.equal(r.state.fields.budget.source, 'default');
  assert.ok(r.defaulted.includes('budget'));
  assert.notEqual(r.readiness, 'blocked');
  assert.ok(!r.missing.includes('budget'));
});

test('6 两个硬字段冲突 → 最新 user_said 胜', () => {
  let r = turn(fresh(), '帮我送过来');
  r = turn(r.state, '算了我自己去拿');
  assert.equal(r.state.fields.mode.value, 'pickup');
  assert.equal(r.state.fields.mode.source, 'user_said');
  r = turn(r.state, '还是外卖吧');
  assert.equal(r.state.fields.mode.value, 'delivery');
  // 过敏同理：先说没有，后来说花生过敏 → known
  r = turn(r.state, '我其实没有过敏');
  assert.equal(r.state.fields.allergyKnown.value, 'none');
  r = turn(r.state, '对了我花生过敏');
  assert.equal(r.state.fields.allergyKnown.value, 'known');
  assert.deepEqual(r.state.fields.allergens.value, ['花生']);
});

test('7 一次只问一个问题（nextQuestion 是单个对象，不是数组）', () => {
  const q = nextQuestion(fresh());
  assert.ok(!Array.isArray(q));
  assert.equal(q.field, 'allergyKnown');
  assert.equal((q.text.match(/[？?]/g) || []).length, 1);
});

test('8 同一字段本会话不重复问：过敏含糊 → 仍 unknown 但不再问、可揭晓', () => {
  let r = turn(fresh(), '午饭吃啥');
  assert.equal(r.nextQuestion.field, 'allergyKnown');
  r = turn(r.state, '应该没事吧');
  assert.equal(r.state.fields.allergyKnown.value, 'unknown');
  assert.equal(r.state.session.askedAllergy, true);
  assert.notEqual(r.nextQuestion?.field, 'allergyKnown');
  assert.notEqual(r.readiness, 'blocked');
});

test('9 不做问卷式连续追问：上一轮问过，这一轮不再接着问', () => {
  let r = turn(fresh(), '没有过敏');
  assert.equal(r.nextQuestion.field, 'fullness'); // 信息增益最高的软问题
  r = turn(r.state, '嗯'); // 他没给新信息
  assert.equal(r.nextQuestion, null);
  assert.equal(r.readiness, 'ready');
});

test('10 随便 / 你定 → 软字段不再问；软字段够 2 个也不问', () => {
  let r = turn(fresh(), '没有过敏，随便你定');
  assert.equal(r.nextQuestion, null);
  assert.equal(r.readiness, 'ready');
  let s = turn(fresh(), '没有过敏，好累，赶时间');
  assert.equal(s.nextQuestion, null);
});

test('11 问句口语化：不含 请提供/请选择/请确认/您', () => {
  for (const q of Object.values(QUESTIONS)) {
    assert.doesNotMatch(q.text, /请提供|请选择|请确认|您/);
    assert.equal((q.text.match(/[？?]/g) || []).length, 1);
  }
});

test('12 过敏原抽取 + 偏好排除，原话不进 state', () => {
  const r = turn(fresh(), '我花生过敏，不吃香菜，我们仨');
  assert.equal(r.state.fields.allergyKnown.value, 'known');
  assert.deepEqual(r.state.fields.allergens.value, ['花生']);
  assert.deepEqual(r.state.fields.avoid.value, ['香菜']);
  assert.equal(r.state.fields.people.value, 3);
  assert.ok(!JSON.stringify(r.state).includes('我花生过敏，不吃香菜'));
});

test('13 本机 health 为 none/known 时不再问过敏；unknown 仍要问', () => {
  const a = createState({ health: { allergyKnown: 'none', allergens: [] } });
  assert.equal(evaluate(a).missing.length, 0);
  const b = createState({ health: { allergyKnown: 'known', allergens: ['虾'] } });
  assert.deepEqual(b.fields.allergens.value, ['虾']);
  const c = createState({ health: { allergyKnown: 'unknown', allergens: [] } });
  assert.equal(evaluate(c).readiness, 'blocked');
});
