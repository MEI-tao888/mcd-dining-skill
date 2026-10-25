import test from 'node:test';
import assert from 'node:assert/strict';
import { createState } from './belief.mjs';
import { observe, toneOf, featurize } from './signals.mjs';
import { ask } from './turn.mjs';
import { checkReply } from './voice.mjs';

const NONE = { allergyKnown: 'none', allergens: [] };
const say = (state, text) => observe(state, text);
const run = (texts) => texts.reduce((s, t) => say(s, t), createState({ health: NONE }));

test('1 同一句话重复 → impatient', () => {
  const s = run(['随便吃点', '随便吃点', '随便吃点']);
  assert.equal(toneOf(s), 'impatient');
  assert.ok(s.signals.reasons.includes('repeat'));
});

test('2 忽略标点和语气词的重复也算', () => {
  const s = run(['吃什么好', '吃什么好啊！', '吃什么好。']);
  assert.equal(toneOf(s), 'impatient');
});

test('3 "我都说了" 一句话就够 → impatient', () => {
  assert.equal(toneOf(run(['有点饿', '我都说了随便'])), 'impatient');
});

test('4 平时不打句号，突然打了 → quiet；基线不足 3 句不触发', () => {
  const s = run(['中午吃啥呢', '有点饿了想吃点', '就在楼下吃吧', '都可以吧。']);
  assert.equal(toneOf(s), 'quiet');
  assert.ok(s.signals.reasons.includes('period-shift'));
  assert.equal(toneOf(run(['中午吃啥呢', '都可以吧。'])), 'normal'); // 基线不足
});

test('5 前面说得长，突然几个字且不是在回答问题 → quiet', () => {
  const s = run(['今天中午想吃点热的东西', '最好是在公司附近的', '不要太贵的那种就行', '算了']);
  assert.equal(toneOf(s), 'quiet');
});

test('6 前面一直带感叹号，突然平了 → quiet', () => {
  const s = run(['饿死了！', '想吃肉！', '快点吧！', '嗯']);
  assert.equal(toneOf(s), 'quiet');
});

test('7 连着两句都只有一两个字 → curt', () => {
  assert.equal(toneOf(run(['好', '嗯'])), 'curt');
});

test('8 正常聊天不误报', () => {
  assert.equal(toneOf(run(['中午吃啥好呢', '想吃点扎实的', '在楼下吃就行'])), 'normal');
});

test('9 原话不进 state，只留特征', () => {
  const s = run(['我家住在某某小区三号楼', '我花生过敏']);
  const dump = JSON.stringify(s);
  assert.ok(!dump.includes('某某小区'));
  assert.ok(!dump.includes('花生'));
  assert.equal(s.signals.recent.length, 2);
  assert.equal(featurize('嗯').k, null);
});

test('10 recent 最多留 6 句', () => {
  const s = run(Array.from({ length: 10 }, (_, i) => `第${i}句说点别的东西吧`));
  assert.equal(s.signals.recent.length, 6);
});

// ---- 接进 turn.ask：多轮对话 ----

test('11 不耐烦时：不再追问口味，直接 proceed', () => {
  let r = ask({ say: '午饭吃啥' }, { health: NONE });
  assert.equal(r.action, 'ask'); // 正常用户会被问一个软问题
  r = ask({ say: '随便吃点', state: r.state });
  r = ask({ say: '随便吃点', state: r.state });
  r = ask({ say: '随便吃点', state: r.state });
  assert.equal(r.tone, 'impatient');
  assert.equal(r.reply, null);
  assert.equal(r.action, 'proceed');
});

test('12 不耐烦也不能绕过过敏闸门：过敏没问过仍要问，只是话变短', () => {
  const unknown = { allergyKnown: 'unknown', allergens: [] };
  let r = ask({ say: '快点吃啥' }, { health: unknown });
  const s0 = structuredClone(r.state);
  s0.session.askedAllergy = false; // 模拟还没问过
  s0.pendingQuestion = null;
  r = ask({ say: '快点吃啥', state: s0 });
  r = ask({ say: '快点吃啥', state: { ...r.state, session: { ...r.state.session, askedAllergy: false }, pendingQuestion: null } });
  assert.equal(r.tone, 'impatient');
  assert.equal(r.readiness, 'blocked');
  assert.match(r.reply, /不能碰的/);
  assert.match(r.reply, /^行，不绕了/);
  assert.equal(checkReply(r.reply).ok, true);
  assert.ok(!r.reply.includes('只记在'));
});

test('13 quiet 时过敏问句放轻', () => {
  const unknown = { allergyKnown: 'unknown', allergens: [] };
  let st = createState({ health: unknown });
  for (const t of ['中午吃啥呢', '有点饿了想吃点', '就在楼下吃吧']) st = observe(st, t);
  const r = ask({ say: '都可以吧。', state: st });
  assert.equal(r.tone, 'quiet');
  assert.match(r.reply, /^就问一句/);
});

test('14 tone 不进 judgeBelief，不改 candidatesArgs', () => {
  let r = ask({ say: '随便吃点' }, { health: NONE });
  r = ask({ say: '随便吃点', state: r.state });
  r = ask({ say: '随便吃点', state: r.state });
  assert.ok(!JSON.stringify(r.judgeBelief).includes('impatient'));
  assert.deepEqual(r.candidatesArgs, ['--mode', 'pickup', '--people', '1']);
});

test('15 软问题新文案过 voice，且仍是一问', () => {
  let st = createState({ health: NONE });
  const r = ask({ say: '午饭吃啥', state: st });
  assert.equal(checkReply(r.reply).ok, true);
  assert.equal((r.reply.match(/[？?]/g) || []).length, 1);
});
