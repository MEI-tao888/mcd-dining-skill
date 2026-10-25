# 0001 · 简单麦 Easy Eat（一页说明书）

Status: ready-for-agent
Owner: A（Builder / WorkBuddy）
Date: 2026-10-21（A1 初稿）· 2026-10-22（A1.5：外送写入底层 + 安全补丁）

## 一句话

吃饭很重要，选饭可以很简单。聊两句，只给一份；不满意说"换"。

## 8 条决策（A 不得改）

| # | 决策 |
|---|---|
| 1 | 产品名 **简单麦 / Easy Eat**；定位 **吃饭很重要，选饭可以很简单**。 |
| 2 | **履约**：默认**到店自取**（`orderType=1`、`beType=1`、不传 `beCode`）；**外送（麦乐送）为第二模式**（`orderType=2`、`beType=2`、传 `beCode`），与核心共用一套候选逻辑，只替换取数/算价适配层（ADR 0005）。**不承诺 ETA、不承诺库存。** |
| 3 | 演示门店：**1960216**（营业到 01:00）或 **1960208**（24h）；**不用 1960335**（22:00 关门）。 |
| 4 | 流程：先聊 → **后台预取**门店/菜单 → 聊到够 → 硬筛 **2–3 组**（不做加权打分、不做排序）→ 算价 → JEV 判断 → 只给**一份** + 一句理由 + 一个「换」。 |
| 5 | 聊天规则：**一次最多 1 问**；只聊这顿饭；不填表；理由**引用用户原话**。 |
| 6 | 记忆：`meal-skill/memory/profile.json`；只存口味/行为，不存个人信息；`.gitignore` 已挡。 |
| 7 | JEV：**只当最后裁判**；没 key 用本地兜底；**不阻塞**。 |
| 8 | 什么算做完：一个真实用户聊 **3–5 句**拿到一份方案；价格来自 `calculate-price`；能换一次；第二天能记住。 |

> 决策 2 的变更（2026-10-22）：初稿是"只做到店自取、外送不做"；现按 ADR 0005 改为"到店自取为默认，外送为第二模式"。**默认路径不变**，外送不抢主链。

## 规则边界（决定代码形状）

- **规则只做硬筛选**：履约方式（默认到店）/ 预算 / 偏好排除 / 门店营业 / 可售。**没有权重、没有评分、没有排序。**
- 候选保留**类型差异**：稳妥 / 轻 / 奖励——三组都合法、都在预算内。
- 在剩下的里挑"最合此刻"，是 **JEV 的活**，不是脚本的活。
- 组内换下一个方案**只发生在算价失败（不可售）**；因超预算而换更便宜的方案 = 比价，**禁止**。

## 安全边界（2026-10-22 补）

1. **过敏警告**：`--avoid` 是**偏好排除**，不是过敏安全机制。它**只按菜单文字**（名称/标签/分类）做关键词匹配，**覆盖不到配料表、酱料、共用工器具与交叉接触**。产品**不承诺"无过敏原"**；过敏请以门店与包装标注为准。
2. **隐私**：`addressId`、联系人、电话、完整地址**只存在于进程内存**，不写仓库、不写日志、不写 `data/*.json`、不打印；对外只用 `addressRef`（如 `addr#1`）。
3. **金额**：只认 `calculate-price`。外送配送费/打包费取返回字段 `deliveryPrice` / `packingPrice`，**不手算**；预算按**含费用的 `data.price`** 硬筛。
4. **兜底不编造**：无地址 → `NO_ADDRESS`；无外送门店 / 超出范围 → `NO_DELIVERY_STORE`；工具失败 → `DELIVERY_LOOKUP_FAILED`。三种情况都**自然回退到店自取**，不虚构门店、地址或价格。

## 已交付：A1 + A1.5

1. `scripts/mcp.mjs`：MCP 客户端（`query-nearby-stores` / `query-meals` / `calculate-price` / `query-meal-detail` / **`delivery-query-addresses`** / **`delivery-query-stores`**），Token 只读环境变量。
2. `scripts/candidates.mjs`：`--mode pickup|delivery`（默认 pickup）+ `--address-id`；**外送时 `--store` 可选**（不传则按「在营 → 打烊更晚 → 更近」自动选一家），pickup 仍必须传；硬筛选 → 2–3 组类型候选 → 逐组 `calculate-price` → 写 `data/candidates.json`。
3. 金额一律按**分**（整数）；菜单、门店、价格**不硬编码**；失败**如实记录**。

未做（属 A3）：UI、真实下单。

## A2 范围（聊天层）

| 交付 | 内容 |
|---|---|
| `skills/easy-eat/SKILL.md` | 性格卡（好奇/直说/体贴/有分寸）、turn contract（接住 + 只推进一步）、belief 闸门、提问规则、工具策略、揭晓（一份 + 引用原话 + 一个「换」）、兜底表 |
| `skills/easy-eat/references/belief-schema.md` | 字段表：`value + confidence + source`；硬/软划分；冲突规则；A3 落盘接口形状 |
| `skills/easy-eat/references/examples.md` | 6+1 段（6 段主流程 + 1 段 `unknown`） |
| `memory/health.json` | 过敏三态 + 过敏原 + 确认时间；**只存本机**，`.gitignore` 已挡，不进仓库 / `data/*.json` / JEV |

- **选择规则**：A2 用「此刻状态 → 候选类型」的占位映射（累→稳妥、赶/轻→轻、奖励→奖励），**不是打分、不是比价**；A3 换成 JEV。
- **过敏确认**：**首次（或本机记录为 `unknown`）问一次**，说明"只记本机、可随时删"；之后 `none`/`known` 不再问；用户说变了 / 清空 / 冲突才再确认一次。
- **不做**：JEV 调用、`profile.json` 落盘、真实下单、多人投票、跨店比价、UI。
- **验收**：短 / 累 / 赶 三段模拟，逐轮记录「问了什么、抓到哪些硬软字段、是否只给一份」；硬字段缺失时只问 1 个；用户说「随便」仍确认过敏（首次/未知时）；**预算只告知默认（`null`），用户改口后带 `--budget` 重跑**。

## A3 范围（本次：揭晓 + 记忆 + JEV judge）

| 交付 | 内容 |
|---|---|
| `scripts/judge.mjs` | 读候选 JSON + belief → 一次 JEV 请求（1 choice + 每组 1 score + 1 noul）→ 决策；`--health` 健康检查；代理经 `--use-env-proxy` 自重拉，`JEV_PROXY_REEXEC` 防递归 |
| `scripts/memory.mjs` | `read` / `update --json` / `clear [--target]`；profile 与 health 分文件；原子写；拒写 PII 字段 |
| `skills/easy-eat/SKILL.md` | §8 选组改为调 judge（失败静默回退）（A6.1 起废止：失败不给方案，见 A6 节）；§7 改为用 memory.mjs；§10 边界更新 |

- **决策门限**：`choice.confidence ≥ 0.55` 且 `violates_hard < 0.5` → 用 JEV 选中的组；否则回退到本地映射，`provider="fallback"`。
- **不改价、不改候选**；judge 只在候选里选。
- **隐私**：judge 的 state 只含对话摘要 + 候选（id/type/餐品/价格/说明）；key 只从环境变量或 `~/.jevmodel/api_key.txt` 读，不打印。
- **验收**：`--health` 200；真实判断贴 choice/confidence/usage；坏代理 → fallback 且 exit 0；外送候选可跑；memory 读写清三态；grep 无 allergens/地址/电话。

## A3.1 范围（券接进候选与算价）

| 交付 | 内容 |
|---|---|
| `scripts/mcp.mjs` | 只读封装 `query-store-coupons`（storeCode + orderType + beType，外送带 beCode）；CLI `coupons` 只打标题/有效期/适用商品，**券码与券 ID 不打印** |
| `scripts/candidates.mjs` | `--coupons auto`（默认关）：候选定完 → 查门店券 → 命中项套券重算 → 用返回 `data.price`；`coupon = { applied, title, savingsCents }`；预算改到券后判断 |
| `skills/easy-eat/SKILL.md` | §0.1 两条原则、§6 `--coupons auto`、§8 券只一句、§10 边界 |
| `docs/*` / `README` / `MCP_INTEGRATION` | 券的真实行为；删掉"券算完"这类提前承诺 |

**产品原则（比实现更硬）**

1. 只给一份。
2. **券服务于决定，不改变决定**：券只让"已经想吃的这一份"更值；不为用券换类型、加商品、改候选；没适用券就一个字都不提，不编"券后价"。

**规则**

- 券只在 `--coupons auto` 时查；查询失败按无券继续，不影响候选。
- 券按「门店 × 订单类型 × 商品」三重匹配（`query-store-coupons`，不用 `query-my-coupons`）。
- 一个候选最多用一张券（不组合）；只给命中的那个 item 传 `couponId`/`couponCode`。
- 券专属 SKU：无券 `price=0` 且 `productList` 为空 → 不得作为普通候选。
- 预算按**券后** `data.price` 判断；券把某组拉回预算内就保留该组，**类型不变**。
- **隐私**：`couponCode` / `couponId` 不写 `data/*.json`、不写日志、不进 JEV；judge state 仍只有候选与软信号。

## A6 范围（可靠优先 + 详情/图片 + 延迟 + JEV 硬门槛）

| 交付 | 内容 |
|---|---|
| `skills/easy-eat/SKILL.md` | §0.2 可靠优先（默认自取、"累"不算送、过敏没答≠没有）、§0.3 + §6.1 JEV 硬门槛、§6.0 顺序与延迟预算、§6.4 详情用法、§8 图/卡与"不降级"、§12 自检 |
| `scripts/detail.mjs` | 只读透传 `query-meal-detail`：`composition` / `canSwap` / `canModify` / `image` / `detailUrl`（实测无此字段 → null） |
| `README` / `MCP_INTEGRATION` | 改成"JEV 必需"；删掉所有"失败静默回退到规则推荐" |

**可靠优先（硬规则）**

1. 默认 `pickup`；只有明确说"送 / 外卖 / 送到家"才 `delivery`，"累 / 不想动 / 下雨"都不算。
2. 过敏没答 → `unknown`，**不得写 `none`**；警告最多一次。
3. 禁用不确定表达：`能选的话 / 应该可以 / 可能 / 大概 / 看情况 / 一般来说 / 理论上`。

**JEV 硬门槛**

- 会话开始 `judge.mjs --health`；不通 → 不查门店、不给方案，只给修复指引。
- 只有 `provider="jev"` 才允许揭晓；`fallback` 的 `chosenId` 一律不用。
- 低置信：最多再问 1 个问题、重判 1 次；仍低 → 不揭晓。**没有规则推荐这档降级。**

**顺序与延迟（实测 2026-10-24）**

```text
health 5.3s → 问过敏 0 调用（首响即时）→ candidates 3.1s → judge 5.5s → detail 2.0s ≈ 16s
```

## 验收

- 到店回归：门店 1960216 + 预算 ¥80 → **3 组**候选，价格可指回 `data.price`。
- 外送：地址 → 外送门店 → `orderType=2`/`beType=2`/`beCode` → 菜单与算价全链跑通，配送费/打包费来自返回字段。
- 外送失败：结构化错误码 + 回退到店自取，不编造。
- 隐私：`data/*.json` 与日志中不出现 `addressId` / 联系人 / 电话 / 完整地址。
- 跑一次真实调用并把关键返回贴进回复；commit。
