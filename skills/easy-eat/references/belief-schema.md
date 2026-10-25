# belief state：字段、置信度、硬/软

> 简单麦每轮都在心里维护这张表。**表不给用户看，但每个判断都要能追溯到表里的某个字段。**
> 本文件只定义结构与判定；落盘（`memory/profile.json`）属 A3，A2 不写文件。

---

## 1. 一条记录长什么样

```json
{
  "mode":         { "value": "pickup",  "confidence": "high", "source": "default",   "updatedAt": "turn-1" },
  "people":       { "value": 1,         "confidence": "high", "source": "default",   "updatedAt": "turn-1" },
  "budgetCents":  { "value": null,      "confidence": "low",  "source": "default",   "updatedAt": "turn-1" },
  "avoid":        { "value": [],        "confidence": "high", "source": "user_said", "updatedAt": "turn-3" },
  "allergyKnown": { "value": "unknown", "confidence": "low",  "source": "default",   "updatedAt": "turn-1" },
  "mood":         { "value": "tired",   "confidence": "mid",  "source": "user_said", "updatedAt": "turn-1" },
  "fullness":     { "value": "light",   "confidence": "mid",  "source": "user_said", "updatedAt": "turn-2" },
  "taste":        { "value": null,      "confidence": "low",  "source": "default",   "updatedAt": "turn-1" },
  "novelty":      { "value": null,      "confidence": "low",  "source": "default",   "updatedAt": "turn-1" },
  "timePressure": { "value": "high",    "confidence": "high", "source": "user_said", "updatedAt": "turn-2" }
}
```

三个必备键：`value`（值）、`confidence`（`high` / `mid` / `low`）、`source`（来源）。
`updatedAt` 只用于判断"这条是不是还用得上"，不对外展示。

> 另外还有**两个不进这张表的会话标记**：`askedAllergyThisSession` / `warnedAllergyThisSession`（见 §2.1）。
> 它们只活在当前会话里，**不落盘、不写 `health.json`**；新会话一律重置为 `false`，否则"警告只出现一次"会变成"永远不再提醒"。

---

## 2. 硬字段（缺了不能揭晓）

| 字段 | 类型 / 取值 | 从哪来 | 默认值 | 缺了会怎样 |
|---|---|---|---|---|
| `fulfillment.mode` | `pickup` / `delivery` | **只认 `user_said`**：听到"送 / 外卖 / 送到家 / 帮我叫外卖" → `delivery`；其余（**包括"累 / 不想动 / 太远 / 下雨"**）→ `pickup` | `pickup` | 默认到店；外送不可用也不追问，直接按到店 |
| `store` | 门店编码（`storeCode`） | `mcp.mjs stores` / `candidates.json` 的 `store` | 无（工具解析） | 由工具给，不问用户"哪家店" |
| `addressRef` | `addr#1` 这类引用 | `mcp.mjs addresses` / `fulfillment.addressRef` | 无 | 外送且无地址 → `NO_ADDRESS` → 回退到店，**不要**问"你家地址" |
| `people` | 整数 ≥1 | 用户说"我们仨/两个人"；否则默认 1 | 1 | 默认 1 人，**明说默认值**让用户纠正 |
| `budgetCents` | 整数（分）/ `null` | 用户说"30 以内/人均 40"；`null` = 不设上限 | `null` | 不设上限；但若用户提过"别太贵"，按 `mid` 记一个预算带 |
| `avoid` | 字符串数组 | 用户说"不吃牛肉/不要辣/不吃香菜" | `[]` | 空数组；**只做偏好排除，不做安全保证** |
| `allergyKnown` | `unknown` / `none` / `known`（**三态**） | 见 §2.1 | `unknown`（**不能默认 `none`**） | `unknown` 时不许说"这份安全"，必须带人工确认警告 |
| 取餐方式 | `dine-in` / `takeaway` | 用户说"带走/在这儿吃/拿了就走" | `takeaway`（赶时间时）/ `dine-in` | 不影响链路，只影响提示语 |

**硬字段的判定标准**：`confidence` 为 `high`，或（用户明确表达过）`user_said`。默认值也算"已知"，但必须**告知用户**（"我按一个人来"）。

**`mode` 不许 `inferred`**：这是唯一一个"宁可给默认值也不许推断"的硬字段。"累/懒/远"都是状态，不是配送意图；推错一次，整份方案的取餐方式就错了。

### 2.1 过敏三态（不能用布尔）

| 值 | 含义 | 怎么得到 | 揭晓时必须怎么说 |
|---|---|---|---|
| `none` | 明确说过"没有过敏" | 用户答"没有 / 不过敏 / 都能吃" | 不必提醒（除非方案本身有高风险项） |
| `known` | 有明确过敏原 | 用户答"花生过敏 / 不能吃虾"；同时写进 `avoid` | 「按你说的把 X 排掉了，配料以门店标注为准」 |
| `unknown` | **没问过、拒答、或含糊** | 用户答"应该没事吧 / 不清楚"；或 `health.json` 里就是 `unknown` | **问过之后才揭晓**；只警告一次：「配料和交叉接触我看不到，你下单前再确认一下」 |

**两个会话标记**（不落盘，新会话重置为 `false`）

| 标记 | 作用 |
|---|---|
| `askedAllergyThisSession` | 本会话是否已经问过过敏。**问过才算**，答得含糊也算问过 |
| `warnedAllergyThisSession` | 本会话是否已经说过那句警告。置 `true` 后不再重复 |

六条规则：

1. **先问，再揭晓**：`allergyKnown=unknown` 且 `askedAllergyThisSession=false` → **禁止给方案**，只问「有没有不能碰的（过敏那种）？」。不许先给方案、后补警告。
2. **什么时候问**：本机 `memory/health.json` 是 `unknown` 或不存在 → 本会话问一次；已是 `none`/`known` → **不问**，直接用。问的那次要说明"只记在这台电脑上、可随时删"；问完把 `askedAllergyThisSession` 置 `true`。
3. **拒答 / 含糊 = `unknown`**，不是 `none`；不许把"没回答"当成"没有"。
4. `unknown` **不阻塞揭晓，但阻塞"安全"断言**：不能说"这份不含过敏原 / 你可以放心吃"；第一次揭晓时补**一次**警告，并置 `warnedAllergyThisSession=true`；**之后他再说"换"也不重复**。
5. **严重过敏**（"过敏很严重 / 会休克 / 一点点就有反应"）：不直接推一份就完——说明到店当面确认，优先给成分明确、能指认的单品，并明确"我不能保证安全"。
6. 过敏信息**只写本机 `memory/health.json`**（结构见 §8），不进 `profile.json`、不进 `data/*.json`、不进 JEV 请求；用户说"清掉"就删，下次会话重新问。

---

## 3. 软字段（至少 2 个到 `mid`）

| 字段 | 取值 | 典型信号 |
|---|---|---|
| `mood` | `low` / `ok` / `high` | "累死了/烦/心情不好" → `low`；"开心/犒劳自己" → `high` |
| `fullness` | `light` / `medium` / `heavy` | "别太撑/吃完还要干活" → `light`；"饿成狗/大口吃肉" → `heavy` |
| `taste` | `spicy` / `mild` / `sweet` / `hot`（热食）/ `plain` | "少辣/不吃辣" → `mild`；"想吃热的" → `hot` |
| `novelty` | `familiar` / `new` | "老样子" → `familiar`；"想尝新/有新品吗" → `new` |
| `timePressure` | `low` / `mid` / `high` | "十分钟后开会/快点" → `high`；工作日午间 → `mid`（推断） |

软字段**只影响选哪一组类型**，不影响合法性：无论选哪组，都必须通过硬筛选与算价。

---

## 4. 置信度怎么定

| 级别 | 判定 | 例子 |
|---|---|---|
| `high` | 用户**明确说出**，或工具**返回的事实** | "我不吃牛肉" → `avoid=high`；`businessStatus=true` → 门店在营 |
| `mid` | 从**语气/长度/时段**合理推断，且只有一个合理解释 | "饿成狗" → `fullness=heavy`；"十分钟后开会" → `timePressure=high` |
| `low` | 猜的、记忆过期、或存在多种解释 | 晚上 21 点猜"想吃夜宵"；上次的预算带（可能已变） |

判定口径：

- **同一个信号只能推一个字段**，不要拿"累"同时推出"想吃甜、想省钱、想快"。
- 推断结果与用户原话冲突 → **以原话为准**，把推断降为 `low`。
- 拿不准就 `low`，并在闸门里当作"没有"。

---

## 5. 来源（source）的四种值

| source | 含义 | 能不能当作用户说的用 |
|---|---|---|
| `user_said` | 用户原话里明确出现 | 能，且理由可以引用 |
| `inferred` | 从语气/上下文推断 | 能用于选组，**不能**写进"你说……"的理由里 |
| `memory` | 上次会话留下的先验 | 能用于少问，冲突时让位当前话 |
| `default` | 兜底默认值 | 必须先告知用户（"我按一个人来"） |

**那句"为什么"只能引用 `user_said` 的内容**，而且要**缝进揭晓的那段话里**——不许单开一段贴"理由"标签。推断的东西说成"你说"，就是编。
`quotes` 就是干这个用的：存 1–3 条他的原话片段（短），揭晓时挑一条顺手带出来，不整句复述。

---

## 6. 冲突与更新

1. **当前话 > 记忆**：这一句否掉上次的，直接覆盖，`source=user_said`。
2. **记忆与当前不一致但用户没说死** → 轻确认一次（"今天还是老样子？"），只一次。
3. **推断与用户原话冲突** → 原话赢，推断降级，不辩解。
4. **同一字段被多次提及** → 取最后一次；若前后矛盾且都明确，问一次"哪个为准"。
5. **不允许静默改硬字段**：预算、人数、过敏的每一次变化都要在回复里体现（"那我按 2 个人重算"）。

---

## 7. 揭晓闸门（readiness）

同时满足才允许给方案：

- 硬字段：`mode`、`people`、`budgetCents`（可为 `null`）、`avoid`、`allergyKnown` —— 全部 `high`，或有明确默认值且已告知；
- **`allergyKnown` 必须是 `none` 或 `known`**：若仍是 `unknown`，且 `askedAllergyThisSession=false` → **闸门不通过，先问**；已问过仍含糊 → 可以揭晓，但只警告一次；
- 软字段：至少 **2 个** `mid` 及以上；
- 没有未解决的冲突。

不满足时：**只问 1 个**最能解锁闸门的问题——优先安全项，然后预算/人数，口味放最后。

**`allergyKnown=unknown` 的四条硬约束**

1. **没问过 → 不给方案**（只问那一句）；给了方案再补警告，顺序就是错的。
2. 可以说方案，**不能说安全**："这份不含过敏原 / 放心吃" 一律禁止。
3. 第一次揭晓补一次：「配料和交叉接触我看不到，你下单前再确认一下。」置 `warnedAllergyThisSession=true`；**换的时候不再重复**。
4. 严重过敏 → 不直接给结论，转到店确认或换成分明确的单品。

---

## 8. 与 A3 的接口（只约定形状，A2 不落盘）

两套本地记忆，**都在 `.gitignore` 里，都只在本机**。

### 8.1 `memory/profile.json`（口味与行为）

A3 写这个文件时，只允许持久化这些字段：

```json
{
  "taste": { "spicy": "mild", "prefers": ["hot"] },
  "usual": ["板烧鸡腿堡"],
  "rejected": ["牛肉"],
  "budgetBand": [2500, 4500],
  "byWeekday": { "wed": "light" },
  "recentChoices": [ { "date": "2026-10-22", "type": "轻" } ]
}
```

**禁止持久化**：姓名、电话、地址、`addressId`、订单号、门店经纬度、任何位置原文。

`rejected` 只代表"他不爱吃"，**不代表过敏安全**。

### 8.2 `memory/health.json`（过敏，仅本机）

```json
{
  "allergyKnown": "none",
  "allergens": [],
  "confirmedAt": "2026-10-22T23:30:00+08:00"
}
```

| 字段 | 取值 | 含义 |
|---|---|---|
| `allergyKnown` | `none` / `known` / `unknown` | 见 §2.1；新建时必须是 `unknown`，不能默认 `none` |
| `allergens` | 字符串数组 | 仅 `known` 时非空；这些词当**偏好排除词**传给 `candidates.mjs --avoid` |
| `confirmedAt` | ISO 时间 / `null` | 上次确认时间；`null` = 从没确认过 |

读写规则：

- 首次确认后写入；之后**只读**——读到 `none`/`known` 就不问，读到 `unknown`（或文件不存在）才问。
- 用户说"过敏变了 / 新增 / 清掉" → 轻确认一次再写；说"清掉"→ 删除记录（文件里回到 `unknown`，或直接删文件），**下次会话重新问**。
- 与本机记录冲突时，**以用户当前话为准**，确认一次后覆盖。

**硬边界**

- `health.json` 的内容**不进 JEV state、不进 `data/*.json`、不进日志、不进仓库**。
- 过滤在**本地**完成：`allergens` → `--avoid` → `candidates.json` 只剩合法候选；JEV 只接收**已过滤的 2–3 组**（餐名 + 价格 + 类型 + 粗粒度状态），不接收过敏原、`addressRef`、联系人。
