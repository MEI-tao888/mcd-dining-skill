# WorkBuddy 开发对话上下文

> 用途：本项目用于参加「麦当劳程序员创意开发大赛 × WorkBuddy」联动专项奖励核验。
> 本文件记录使用腾讯 WorkBuddy 智能体开发本项目的对话上下文（节选）。
> 脱敏说明：所有 MCP Token、GitHub Token、手机号、邮箱、地址均以 `<已脱敏>` 占位。

## 一、开发方式

| 项目 | 内容 |
|---|---|
| 开发工具 | 腾讯 WorkBuddy（Agent 模式） |
| 开发日期 | 2026-10-21 至 2026-10-24（git 首个提交 2026-10-21 17:47，A6.3 提交 2026-10-24 16:15，均为 `+0800`） |
| 工作区 | `C:\Users\<用户>\WorkBuddy\2026-10-21-17-59-47\1024切磋大赛\meal-skill`（用户名已脱敏） |
| MCP 接入 | 通过 WorkBuddy 自定义连接器配置 `mcd-mcp`（`https://mcp.mcd.cn`） |
| 运行环境 | Windows 10.0.26200；Node v24.21.0（项目要求 Node 22+） |

## 二、开发过程（对话记录）

本仓库的开发记录按步骤写在第五至第十二节（G 选题、A1–A6.3），每一步带命令、返回和退出码。**这里没有粘贴 WorkBuddy 的原始导出对话**：如需补充，须由使用者导出并脱敏后再放入，当前未做，如实标注。

关键节点与所在位置：

| 节点 | 位置 |
|---|---|
| 需求澄清 / 选题 | 第五节 |
| MCP 连通性与候选、算价 | 第六节（A1） |
| 外送第二模式 | 第七节（A1.5） |
| 聊天层与过敏确认 | 第八节（A2） |
| JEV 接入与记忆 | 第九节（A3） |
| 券 | 第十节（A3.1） |
| 可靠优先、详情、JEV 硬门槛 | 第十一节（A6） |
| A6.1 / A6.2 / A6.3 证据 | 第十二节 |

> **阅读提示**：第五至第十节写于 A6 之前，是当时的真实记录。凡标注「已被 A6 取代」的段落现已不再成立；以第十一、十二节和代码为准。

## 三、关键决策记录

| 决策点 | 结论 |
|---|---|
| 场景定位 | 工作日午餐 1–2 人；黄金路径 = 到店自取，外送（麦乐送）为第二模式（ADR 0005）；不做美食探索 |
| 是否自动下单 | 否，仅输出确认单；写操作需用户确认 |
| 价格来源 | 一律使用 `calculate-price` 权威返回 |
| 谁做判断 | 规则只做硬筛；JEV 在剩下的 2–3 组里做最终判断（ADR 0004） |
| JEV 不可用时 | **不推荐**，不降级成规则推荐（A6.1 起，见 11.3） |

## 四、声明

本项目真实使用腾讯 WorkBuddy 智能体开发，下文各节取自真实开发会话中的命令与返回，未编造；但第二节说明了原始对话导出尚未放入。项目为参赛者独立开发，非麦当劳官方产品，亦非 WorkBuddy 官方产品。

---

## 五、选题定稿记录（角色 G）

> 角色：G（Griller）——只做选题定稿与记录，不改代码。
> 日期：2026-10-21 23:25（北京时间）
> 模型：DeepSeek-V4.1-Flash（WorkBuddy Agent 模式）
> 输入：`AGENTS.md`、`README.md`、`research/01`、`research/02`、`GLOSSARY.md`
> 脱敏：本次记录不含任何 Token、手机号、地址、账号信息。

### 5.1 定稿（5 句）

> **部分已被 A6 取代（2026-10-24）**：第 4 句「后台静默预取」「规则筛到 2–3 组」仍成立；第 5 句里「取餐方式只做到店自取」已被外送第二模式取代（第七节，ADR 0005），「不可用即 fail-open 到确定性打分」已被 A6.1 取代：JEV 不可用时**不推荐**（第十一节 11.3、第十二节）。「交付止于确认单」仍成立。下面保留 10-21 的原文。

1. **产品名**：简单麦（Easy Eat）——本次参赛用「简单麦」，长期品牌「Easy Eat」，core 与 provider 分离，将来接别的门店只加 adapter。
2. **定位**：不是推荐器，是决策器——**吃饭很重要，选饭可以很简单**（Eat well. Choose easy.）；卖的是"不用在选项里选"，不是"更会推荐"。
3. **目标用户**：注意力已被工作 / 带娃 / 学习占满、想吃得不差但不肯再为点餐做一次决策的人（工作日午餐的 1–2 人；不是美食探索者）。
4. **核心体验**：像饭搭子聊两三轮（一次最多一个问题、镜像对方语气、能推断就不问）→ 后台静默预取门店与菜单 → 确定性筛到 2–3 组并权威算价 → JEV 只在其中挑一组 → 只揭晓一份，附一句引用用户原话的理由 + 唯一出口"换"；下次开口更短。
5. **边界**：取餐方式只做到店自取、场景只做一个；JEV 只做最后裁判（不生成候选、不聊天、不做多步推理），不可用即 fail-open 到确定性打分；交付止于「确认单」，真实下单 / 多人投票 / 跨店比价 / UI 一律不做。

### 5.2 记录一个未采纳的异议（已被 5.4 否决，且已被 A6 取代）

> **已被 A6 取代**：本节主张「黄金路径默认不调 JEV、由确定性打分给唯一一组」。5.4 已否决；A6.1 起更进一步，JEV 是必需裁判，没有 JEV 就不推荐，也没有规则兜底。以下为 10-21 原文，仅作历史记录。

**异议对象：把 JEV 放在黄金路径上（即便只做最后裁判）。**

理由：

1. **边际信息接近零。** 候选只有 2–3 组，且已被确定性打分排过序；"在 2 个已排序选项里选 1 个"规则就能做，JEV 在这件事上不提供新信息，却要付出一个外部 key、一次网络往返、一个 fail-open 分支、一条演示时可能断的链。
2. **它自己的边界正落在我们最需要它的地方。** 置信度 ≠ 正确率；低置信时设计上仍然回落到确定性打分。等于"有把握时不需要它、没把握时也只能靠规则"，那它在主链上是观测点，不是决策点。
3. **会把差异化讲歪。** 评委问"为什么不是 if-else 排序"，若回答"因为用了 JEV"，差异化就变成一个模型选型，而不是产品判断。真正的差异是"只给一份、敢不问"。
4. **演示风险不成比例。** 3 分钟里最贵的是算价 / 券 / 兜底这些硬证据，不是一次模型调用的置信度。

**处置（减法，不加功能）**：黄金路径默认不调 JEV，仍由确定性打分给出唯一一组；JEV 只在录制与答辩时作为**对照证据**出现——同一份候选，现场比"规则选的"与"JEV 选的"是否一致。一致说明规则够用，不一致才是真正的加分叙事。这样 demo 不会因外部依赖断掉，JEV 也从"依赖"变成"证据"。

> 状态：已拍板（见 5.4：不采纳）。~~待使用者在 10-22 22:00 选题冻结前拍板~~

### 5.3 一致性待办（非异议，不改范围）

- `GLOSSARY.md` 的「用餐需求」「确认单」仍把"取餐方式 / 位置"列为字段，而 5.1 已把取餐方式锁死为到店自取；建议注明"本期仅到店自取"，避免术语与边界打架。（**已被 ADR 0005 取代**：外送已是第二模式，此条不再适用；GLOSSARY 其余口径本轮未核对。）
- `README.md` 的「目标用户」仍是 TODO，口径以 5.1 第 3 句为准。

### 5.4 拍板记录：JEV 保留在黄金路径（2026-10-21 23:35）

G 的异议前提是"候选已被确定性打分排序"；但实际设计不是这样：

- **规则只做硬筛选**（预算/忌口/门店营业/取餐方式/可售），不做加权评分，也不排序；
- 保留 2–3 组都合法、但类型不同的候选（稳妥 / 轻 / 奖励）；
- 最后由 **JEV 做判断**：`choice` + `score` + `boolean` + `confidence`；
- ~~JEV 不可用/超时/低置信 → **安全默认**（最稳/最便宜/最熟悉），不是加权打分。~~ **已被 A6.1 取代**：JEV 不可用/超时/低置信 → judge `exit 2`、`chosenId=null`，**不推荐**，没有安全默认档（第十一节 11.3、第十二节）。

因此 G 的异议**不采纳**：它反对的是"规则已经做完判断"的 JEV，而我们的规则只负责排除不合适的。~~JEV 的成本和断链风险用"预取 + 超时 + 兜底"处理。~~ **已被 A6.1 取代**：断链时不给方案，并如实告知原因，不用规则顶替。

决策：**规则=筛掉不合适的；JEV=在剩下的里选最合此刻的。**

---

## 六、A1 记录：取数 + 候选（2026-10-21 23:44，Builder）

> 角色：A（Builder）——只写 `meal-skill/`，不改选题、不加功能。本次只做 A1。
> 输入：`AGENTS.md`、`GLOSSARY.md`、`README.md`、`research/02`、`docs/adr/0004`。

### 6.1 范围

> 本表是 A1 当时的范围。「没做」一栏里的 `SKILL.md`、`judge.mjs`、`memory.mjs`、外送已在后续各节完成（七至十一节），不再是缺口。

| 做了 | 没做 |
|---|---|
| `docs/specs/0001-easy-eat.md`（8 条决策一页纸） | `SKILL.md`、聊天层（A2） |
| `scripts/mcp.mjs`（MCP 客户端 + CLI） | `judge.mjs`、`memory.mjs`（A3） |
| `scripts/candidates.mjs`（硬筛 + 2–3 组 + 权威算价） | 加权评分 / 排序 / 券测算 / 下单 |
| `data/candidates.json`（真实候选） | 第二场景、外送 |

### 6.2 实现要点

- **只硬筛选**：取餐方式（到店自取 `orderType=1`/`beType=1`，不传 `beCode`）、门店营业（`businessStatus`）、菜单存在（可售）、忌口（名称/标签/分类关键词）、预算（`calculate-price` 的 `data.price`）。
- **不评分不排序**：候选按固定类型顺序输出（稳妥 → 轻 → 奖励）；组内换下一个方案**只在算价失败/不可售时**发生，超预算直接剔除整组（不换更便宜的，那等于比价）。
- **金额按分**：`totalCents` 为整数；`totalYuan` 只做格式换算。一致性校验两条：`price = productPrice + deliveryPrice + packingPrice`（到店无后两项）与 `originalPrice − discount = price`。**`productPrice` 已是折后商品价（`discount` 已含在其中），不再二次减 `discount`。**
- **无硬编码**：门店码/城市/关键词来自入参；商品码、名称、分类、价格全部来自 MCP 返回。
- **Token**：只读 `MCD_MCP_TOKEN`；代码里只有 `${this.config.token}`，仓库无明文。

### 6.3 真实调用证据（2026-10-21 23:44:27，门店 1960216）

| # | Tool | 入参摘要 | 结果 | 耗时 | traceId |
|---|---|---|---|---|---|
| 1 | `query-nearby-stores` | 武汉 / 华中农业大学 / searchType=2 / beType=1 | 5 家门店；1960216 在营 07:00-01:00，距 1196m | 582ms | `87418fd261f6434c517ed64ce8a4eced` |
| 2 | `query-meals` | storeCode=1960216 / orderType=1 / beType=1 | 15 个分类 / 120 个商品 | 861ms | `eb6f4fc1b4e6234fa4daaf91b55f0463` |
| 3 | `calculate-price` | 9900004064×1 | `price=3450` 分（¥34.50） | 148ms | `eb86548a3f61e8dc51a85f9da7ab945c` |
| 4 | `calculate-price` | 9900011128×1 | `price=2800` 分（¥28.00） | 132ms | `0fe942beb098c186b2c2f84b2eb9df7a` |
| 5 | `calculate-price` | 511781×1 + 9900016076×1 + 9900015561×1 | `price=6030` 分（¥60.30） | 167ms | `1d8451a26389dc620aff7b3d668be000` |

### 6.4 候选（1 人 / 到店自取 / 预算 ¥80）

| 类型 | 具体方案 | 合计（分） | 规则 |
|---|---|---:|---|
| 稳妥 | 精选单人餐三件套 ×1 | 3450 | 分类名含「单人餐」的第一个 |
| 轻 | “堡”你欢乐套餐 ×1 | 2800 | 分类名含「500大卡」的第一个 |
| 奖励 | 培根安格斯厚牛堡 ×1 + “我就喜欢”鸡薯双全盒 ×1 + 麦咖啡冰爽一夏 ×1 | 6030 | 厚牛堡 + 可分享小食 + 饮品 |

### 6.5 额外验证过的两次硬筛

- `--budget 60`：奖励组 ¥60.30 超预算 → **整组剔除**，且没有回退到"去掉饮品"的便宜版（否则就是比价）。
- `--avoid 牛肉`：厚牛堡被忌口剔除 → 奖励组整组不成立（如实记录，不硬凑）。

### 6.6 已知边界（写清，不掩饰）

- 忌口只按菜单文字匹配，配料表覆盖不到；过敏不能只靠这一层。
- 候选的"类型"靠菜单分类名/标签的规则映射；门店分类改名会导致该组落空（会记进 `rejected`）。
- `calculate-price` 未验证套餐内部组成（`query-meal-detail` 属 A3 备用）。
- 券未测算：`query-store-coupons` + 券后价留给 A3。

---

## 七、A1.5 记录：外送写入底层 + A1 安全补丁（2026-10-22 20:44，Builder）

> 角色：A（Builder）。本轮只做 A1.5；不做 A2/A3、不写 `SKILL.md`、不碰聊天层。
> 依据：`docs/adr/0005-delivery-second-mode.md`（外送=第二模式，与核心共用）。

### 7.1 改了什么

| 文件 | 改动 |
|---|---|
| `scripts/mcp.mjs` | 新增 `deliveryQueryAddresses` / `deliveryQueryStores`；CLI 加 `addresses`（只列出 `addr#N`）与 `dstores`（按地址序号查外送门店，不传 addressId）；`price/meals` 支持 `--order-type/--be-type/--be-code`；`printPrice` 增加配送费/打包费字段行 |
| `scripts/candidates.mjs` | 新增 `--mode pickup\|delivery`（默认 pickup）与 `--address-id`；履约解析层 `resolveFulfillment`；外送失败结构化回退；金额拆到 `price.breakdown`（字段直取）；`--avoid` 改为**偏好排除**并写入 `rejected`；隐私脱敏（`addressRef` 替代 addressId） |
| `docs/specs/0001-easy-eat.md` | 决策 2 改为「默认到店自取 + 外送第二模式」；新增「安全边界」四条（过敏/隐私/金额/兜底）；A1.5 范围与验收 |
| `README.md` | 「它怎么工作」补履约；「边界与安全」补履约范围、过敏警告、隐私、费用字段 |
| `data/candidates.delivery.json` | 新增：外送全链的真实候选与算价证据 |

**没做**：`query-store-coupons` 的外送封装（本轮不测算券，属 A3；`orderType/beType/beCode` 已经贯通，A3 加一行即可）。

### 7.2 外送全链真实返回（2026-10-22 20:44，门店 1960216，地址 `addr#1`）

| # | Tool | 入参摘要 | 关键返回 | traceId |
|---|---|---|---|---|
| 1 | `delivery-query-addresses` | 无参 | `data.addresses` 1 条；对外只记 `addr#1` | — |
| 2 | `delivery-query-stores` | `beType=2` + `addressId`（不落盘） | 2 家可配送：1960335 / **1960216**（均带 `beCode`） | — |
| 3 | `query-meals` | `orderType=2`、`beType=2`、`beCode` | 14 个分类 / 122 个商品 | — |
| 4 | `calculate-price` | `9900002995×1` | `productPrice=4100` + `deliveryPrice=600` + `packingPrice=190` = `price=4890` | `7042288cd0899ffe117a58579d4fd14d` |
| 5 | `calculate-price` | `9900011129×1` | `3590 + 600 + 190 = 4380` | `b7cfa6505db2b90bf210420ec4f500ae` |
| 6 | `calculate-price` | `902060×1 + 9900016511×1 + 515946×1` | `productPrice=6380`（**已折后**）+ 600 + 190 = `price=7170`；校验 `originalPrice 7880 − discount 710 = 7170` | `41a052db6912834b0f6279c4cee68161` |

**金额口径（统一按此讲，别再说错）**

- `price = productPrice + deliveryPrice + packingPrice`（到店自取没有后两项）；
- `originalPrice − discount = price`；
- **`productPrice` 已经是折后商品价**，`discount` 已经体现在里面，**不要再从 `price` 里减一次 `discount`**。
- 例（奖励组）：`6380 + 600 + 190 = 7170`，且 `7880 − 710 = 7170`；不是 `6380 + 600 + 190 − 710`。

外送菜单与到店菜单**不是同一份**：门店 1960335 的到店菜单是 15 分类，外送是 14 分类（无「精选单人餐」，主食套餐改挂「鸡肉汉堡/卷」「大堡口福」等），同一商品外送价也更高（例：「堡」你欢乐套餐到店 ¥28.00 / 外送 ¥35.90）。所以 `query-meals` 必须按履约方式各取一次。

### 7.3 到店回归（同一门店、预算 ¥80）

| 类型 | 方案 | 合计（分） | traceId |
|---|---|---:|---|
| 稳妥 | 精选单人餐三件套 ×1 | 3450 | `c587f1282a82b21cadc737006a04c6fe` |
| 轻 | “堡”你欢乐套餐 ×1 | 2800 | `80efadd5ac5bc48f911eb5d1ebb60968` |
| 奖励 | 培根安格斯厚牛堡 + 鸡薯双全盒 + 麦咖啡 | 6030 | `17898c44f136c916dfef0c4d6b6cfc7a` |

结果与 A1 完全一致（3450 / 2800 / 6030），未因外送改造回归。

### 7.4 兜底与安全补丁的实测

- **NO_ADDRESS**：`--mode delivery --address-id 000000000`（不存在的地址）→ `fulfillment.fallback.code = NO_ADDRESS`，**自动回退到店自取**并给出 3 组候选，未编造地址/门店。
- **偏好排除**：`--avoid 牛肉` 命中 15 个商品，`rejected` 逐条写 `因偏好排除词「牛肉」被剔除`，筛选记录里明确写「仅按菜单文字匹配，不保证过敏安全」。
- **隐私**：两份 `data/*.json` 均无 `addressId` / `phone` / `contactName` / `fullAddress` / 11 位手机号；调用记录里地址只以 `addressRef: "addr#1"` 出现。

### 7.5 已知边界

- `--address-id` 需要调用方自己提供；不传时默认用地址列表第 1 条。
- 外送菜单顺序由门店返回决定，不同时刻可能变化 → 同类型候选可能换商品（价格仍以当场 `calculate-price` 为准）。
- 配送费/打包费只读返回字段；若某门店不返回该字段，脚本不会补 0，也不会估算。
- 过敏仍不设保证：偏好排除挡不住配料表与交叉接触。

### 7.6 补丁：外送可以不传 `--store`（2026-10-22 20:55）

**改动**：`--store` 在 `delivery` 下变为可选；不传时按固定规则自动选一家，`pickup` 仍必须传。

- 选店规则（固定、可解释，不是候选排序）：`businessStatus=true` 且有 `beCode` → **打烊更晚** → **距离更近** → 门店返回顺序。
- 打烊时刻按分钟比较并处理跨夜：`07:00-01:00` 记为 1500，`07:00-22:00` 记为 1320 → 凌晨店赢。
- `delivery-query-stores` **不返回 `distance`**，所以第二键在当前数据下失效；这一点写进 `fulfillment.storeSelection.distanceFieldAvailable=false`，不假装有距离。
- 全部可配送门店都不在营业 → `NO_DELIVERY_STORE`（`detail` 列出每家的营业时间与状态）→ 回退到店自取；回退也用同一套选店规则。
- 选店过程完整落在 `fulfillment.storeSelection.considered[]`（编码/营业时间/closeMinutes/在营），可复核为什么选了这家。

**实测（20:55，预算 ¥80，1 人）**

| 场景 | 命令要点 | 结果 |
|---|---|---|
| 外送自动选店 | `--mode delivery`，无 `--store` | 候选门店 1960335(22:00)、1960216(01:00) → 选 1960216；3 组：4890 / 4380 / 7170 |
| 无效地址 | `--mode delivery --address-id 000000000` | `NO_ADDRESS` → 回退到店自取（同样自动选到 1960216）；3 组：3450 / 2800 / 6430 |
| 到店回归 | `--store 1960216` | 3 组：3450 / 2800 / 6430 |
| pickup 缺 store | 不传 `--store` | 直接报错退出（`pickup 模式必须传 --store`），不猜门店 |

**回归差异说明**：到店奖励组从 ¥60.30 变成 ¥64.30，是因为门店在晚间切换了菜单（同一门店 20:44 是 122 个商品，20:55 是 119 个，小食拼盘首个商品从「鸡薯双全盒」变「韩式甜辣酱鸡块8块」）。**不是代码回归**；三组结构、类型规则、算价一致性都没变。

### 7.7 A1.6 安全补丁（2026-10-22 21:15）

- **`call` 拒绝敏感工具**：`mcp.mjs` 增加 `SENSITIVE_TOOLS = new Set(['delivery-query-addresses', 'delivery-query-stores'])`；`call` 分支命中即拒绝（`exitCode=2`），**不发起调用、不打印结果、不写 `--out`**，只回一句「该工具含个人信息，禁止用 call 打印/落盘；请用 addresses 命令（只输出 addr#N）」。
- `addresses` / `dstores` 保持原样：前者只输出 `addr#N`，后者 `beCode` 截断为前 2 位 + `**`，两者都跳过 `--out`。
- `data/*.json` 统一走 `writeReport()`：脱敏 + **末尾换行**（UTF-8，符合 §5）。
- **规则变更（按 AGENTS §9 记录）**：`AGENTS.md` §0 的「当前阶段」由 **选题冻结前** 改为 **10-22 架构冻结点**（现行原文：`当前阶段：**10-22 架构冻结点**。黄金路径 = 到店自取；外送 = 第二模式，与核心共用，底层同期写入。`）。该变更只动阶段说明，未触及 §1 硬约束；对应决策见 `docs/adr/0005-delivery-second-mode.md`。

---

## 八、A2 记录：聊天层（2026-10-22 22:15，Builder）

> 角色：A（Builder）。本轮只写聊天层；**没改 `mcp.mjs` / `candidates.mjs`**，不接 JEV、不实现 memory 落盘。

### 8.1 交付

| 文件 | 内容 |
|---|---|
| `skills/easy-eat/SKILL.md` | frontmatter（name/description/version/author）+ 性格卡 + turn contract + belief 闸门 + 提问规则 + 工具策略 + 揭晓 + 兜底 + A2 边界 + 揭晓前自检 |
| `skills/easy-eat/references/belief-schema.md` | 字段定义（`value + confidence + source`）、硬/软划分、置信度判定、冲突规则、A3 落盘接口形状 |
| `skills/easy-eat/references/examples.md` | 6+1 段（6 段主流程 + 1 段 `unknown`）+ 四种反例 |
| `docs/specs/0001-easy-eat.md` | 新增「A2 范围」小节；A1/A1.5 段落改为「已交付」 |

### 8.2 三个关键设计

1. **turn contract 只有两条**：接住上一句 + 只推进一步。陈述优先，但**信息不足时提问优先**，70/30 不是指标——避免"为了自然不问硬字段"。
2. **揭晓闸门**（硬字段已知/高置信 + 软字段 ≥2 个 `mid`）放在调用 `candidates.mjs` **之前**；缺硬字段只问 1 个，且优先问安全项（过敏）＞预算/人数＞口味。
3. **A2 的选组是占位映射**：累→稳妥、赶/轻→轻、奖励→奖励；两组都贴就选"更稳"的那组。**不是打分、不是比价**，A3 换成 JEV。

### 8.3 验收：4 段模拟（短 / 累 / 赶 / 随便）

> 真实数据（2026-10-22 22:11，门店 1960216 在营 07:00-01:00，1 人、未设预算）：
> 稳妥 = 精选单人餐三件套 **¥34.50**；轻 = “堡”你欢乐套餐 **¥28.00**；奖励 = 培根安格斯厚牛堡 + 韩式甜辣酱鸡块8块 + 麦咖啡 **¥64.30**（三组 `integrityOk=true`，调用 5 次 0 失败）。

**① 短（三个字进来）**

| 轮 | 用户 | 简单麦（动作） | 抓到什么 |
|---|---|---|---|
| 1 | 午饭吃啥 | 陈述 + **1 问**：「看你这架势是不想动脑。想吃扎实点，还是吃完还能干活？」 | 硬：`mode=pickup`(默认)、`people=1`(默认)、`budget=null`(默认)；软：`timePressure=mid`(inferred) |
| 2 | 干活 | 陈述 + 告知默认：「懂了，不给你配太撑的。」 | 软：`fullness=light`(**user_said**) |
| 3 | 嗯 | **过敏确认（单独一句，1 问）**：「有没有不能碰的（过敏那种）？」 | 等 `allergyKnown` |
| 4 | 没有 | **只给一份**：轻 · ¥28.00；理由引用「你说"吃完还能干活"」；出口「不合适你说换」 | `allergyKnown=none`、`avoid=[]`；软字段 2 个（`fullness=light` high、`timePressure=mid`）→ 过关 |

问句数 2（方向 + 过敏，**分两轮**，每轮 1 个问号）；给 1 份；无列表。

**② 累（心情低）**

| 轮 | 用户 | 简单麦（动作） | 抓到什么 |
|---|---|---|---|
| 1 | 今天累死了，还没吃 | 先接情绪 + 给方向（**这一轮不问**）：「那今天别吃太复杂。热的、带点甜的……我给你配个不用动脑的。」 | 软：`mood=low`(user_said)、`taste=hot/sweet`(inferred)；硬：默认三项 |
| 2 | 嗯，好 | **过敏确认（单独一句，1 问）**：「有没有不能碰的（过敏那种）？」 | 等 `allergyKnown` |
| 3 | 没有 | **只给一份**：稳妥 · ¥34.50；理由引用「你说"累死了"」；出口「换」 | `allergyKnown=none`；软字段 2 个（mood + taste）→ 过关 |

问句数 1（只问过敏，没问口味）；给 1 份；不演心理医生（没说多巴胺/血清素）。

**③ 赶（十分钟开会）**

| 轮 | 用户 | 简单麦（动作） | 抓到什么 |
|---|---|---|---|
| 1 | 十分钟后开会，随便吃点 | 接时间压力 + **1 问（带默认）**：「那不能等。给你配个拿了就走的，不辣不撑——行吗？」 | 硬：`取餐=takeaway`(user_said「拿了就走」)、`timePressure=high`(user_said)；软：`fullness=light`(inferred) |
| 2 | 行 | **过敏确认（1 问）**：「有没有不能碰的（过敏那种）？」 | 等 `allergyKnown` |
| 3 | 没有，快点 | **只给一份**：轻 · ¥28.00；理由引用「你说"十分钟后开会"」；口播默认「我按一个人来」 | `allergyKnown=none`、`avoid=[]`；`taste=mild`(user_said「不辣不撑」= 用户点头) |

问句数 2（口味默认 + 过敏，**两轮各 1 个**）；给 1 份；**不承诺 ETA**。

**④ 随便（专测"仍确认安全"）**

| 轮 | 用户 | 简单麦（动作） | 抓到什么 |
|---|---|---|---|
| 1 | 随便，你定 | 收软偏好 + **只问安全那一个**：「行，那我按最稳的来，不好吃你换。就一个事：有没有不能碰的（过敏那种）？」 | 软偏好全部收（不问口味/饱腹）；硬：`people=1`、`budget=null` 默认 |
| 2 | 没有 | 记 `allergyKnown=none`、`avoid=[]` → **只给一份**：稳妥 · ¥34.50；理由引用「你说"你定"」 | 硬字段齐；软：`novelty=familiar`(inferred) |
| 2' | （若说"预算 30"） | 不删商品凑价，直接带 `--budget 30` 重跑；三组都超 → 如实说「这个价超了」 | `budgetCents=3000`(user_said) |

问句数 1（只问过敏，不问口味）；给 1 份。

**⑤ 含糊回答（`unknown` 分支，补测）**

| 轮 | 用户 | 简单麦（动作） | 抓到什么 |
|---|---|---|---|
| 1 | 今天吃啥，快点 | 「给你配个不折腾的。有没有不能碰的（过敏那种）？」 | `timePressure=high`(user_said) |
| 2 | 应该没事吧，不太清楚 | **仍给一份**：稳妥 · ¥34.50 +「配料和交叉接触我看不到，你下单前再确认一下」 | **`allergyKnown=unknown`**（不是 `none`）；`avoid` 保持空但不当成安全 |

问句数 1；**没有说"这份不含过敏原/放心吃"**。若答"过敏很严重"→ 不给结论，转到店确认 + 成分明确的单品。

### 8.4 合规自检（对照验收）

| 检查项 | 结果 |
|---|---|
| 硬字段缺失时只问 1 个 | ✅ ①③ 各 2 问但**分两轮、每轮 1 个**；②④ 各 1 问；没有一轮出现两个问号 |
| 说「随便」仍确认过敏；预算只告知默认 | ✅ ④ 只问过敏；预算告知默认 `null`，用户改口后带 `--budget` 重跑 |
| **首次揭晓前确认过敏** | ✅ ①②③④⑤ 都有独立的过敏问句，且都在揭晓之前 |
| **过敏不与口味挤在同一句** | ✅ 每段过敏问句都是单独一轮、单独一句；口味判断留在上一轮（A2.2 把 ①③ 也拆开了） |
| **含糊回答不当「没有」** | ✅ ⑤「应该没事吧」→ `allergyKnown=unknown` + 警告句，未说"安全" |
| 无列表 / 无表单 / 无「根据你的画像」 | ✅ 五段都是散文，理由是用户原话 |
| 只给一份 | ✅ 五次揭晓都只有一组，出口只有「换」 |
| 价格来源 | ✅ 全部原样搬 `price.totalYuan`（3450/2800/6430 分），无自算 |
| 过敏提示 | ✅ `none` 不提醒；`unknown` 必带「配料和交叉接触我看不到，你下单前再确认一下」 |

### 8.5 已知边界

- `candidates.mjs` 默认 `--out` 不区分 mode（跑 delivery 不带 `--out` 会覆盖到店样本）——**A2 不改数据层**，SKILL 里要求显式传 `--out`。
- 候选只有类型标签（稳妥/轻/奖励），没有"更快出餐""更近"这类字段，所以「赶时间」只能靠选「轻」近似，无法真的按出餐时长排序。
- `avoid` 只是偏好排除，不保证过敏安全；SKILL 已把它写成硬性提示，但这是产品级限制，不是聊天层能补的。
- 记忆只写了用法（人话引用、可清空、不存地址/电话），实际读写等 A3。

### 8.6 A2.1 安全补丁：过敏确认（2026-10-22 22:32）

**只改过敏这一条链路，其他逻辑不动。**

| 文件 | 改动 |
|---|---|
| `SKILL.md` §4 | 拆出 **4.1 过敏确认**：首次揭晓前必须单独问一次「有没有不能碰的（过敏那种）？」；**删掉「拒答 → 无排除」的默认**，改为「过敏只能默认未知 + 人工确认警告」；新增严重过敏处理（不直接推、转到店确认 + 成分明确的单品） |
| `SKILL.md` §3 / §6.3 / §8 / §12 | `allergyKnown` 改三态；揭晓模板加可选警告句；自检第一条改为「我有没有确认过敏？没确认就不能说这份安全」 |
| `belief-schema.md` | 新增 §2.1「过敏三态」表（`none`/`known`/`unknown` + 揭晓时必须怎么说）；§7 闸门加三条硬约束；§8 明确**过敏信息不进记忆** |
| `examples.md` | 短 / 累 / 赶 都补了独立过敏问句并标注 `allergyKnown`；`随便` 保留；新增第 7 段 `unknown` 分支演示；`第二次来` 说明过敏仍需每会话重问 |

**为什么不能默认「没有」**：`--avoid` 只按菜单文字匹配，盖不住配料表、酱料与交叉接触；把「没回答」当成「没有」，等于用一句没说过的话给用户发安全承诺。所以：**`unknown` 可以不阻塞揭晓，但必须阻塞「安全」这句话。**

**重跑验收（22:31，门店 1960216 在营 07:00-01:00，菜单 119 个商品，价格与上一轮一致）**

| 场景 | 过敏问句出现在 | `allergyKnown` | 揭晓 | 是否只给一份 |
|---|---|---|---|---|
| 短 | 第 3 轮（方向问完之后，单独一句） | `none` | 轻 ¥28.00 | ✅ |
| 累 | 第 1 轮末（只问过敏，未问口味） | `none` | 稳妥 ¥34.50 | ✅ |
| 赶 | 第 2 轮（口味确认之后，单独一句） | `none` | 轻 ¥28.00 | ✅ |
| 随便 | 第 1 轮（只问安全项） | `none` | 稳妥 ¥34.50 | ✅ |
| 含糊（补测） | 第 1 轮 | **`unknown`** | 稳妥 ¥34.50 + 警告句 | ✅ |

问句数分别 2 / 1 / 2 / 1 / 1，**每轮仍只有 1 个问号**；四段正式验收全部 `allergyKnown=none` 或 `unknown`，没有一段是"没问就揭晓"。

### 8.7 A2.2 文档补丁（2026-10-22 23:10，只改文档）

| 文件 | 改动 |
|---|---|
| `references/examples.md` 段 2 | 删掉「板烧要不要？」（那一轮原本有两个问句 + 预设商品）；这轮只留「大口吃肉 / 清爽点」；过敏**另起一轮**单独问，标注 `allergyKnown=none` |
| `references/examples.md` 段 6 | 拆成两轮：先「还是老样子？……换轻一点」→ 用户「嗯」→ 再单独问过敏；**删掉那句暗示"系统记得过敏史"的追问**；`allergyKnown` 改为**本会话重新确认** |
| `references/examples.md` 段 1 / 段 3 | 顺手把「接情绪 + 过敏问句」拆成两轮，保证过敏那句里**一个口味词都没有** |
| `SKILL.md` §11、`examples.md` 开头、`workbuddy.md` 8.1、`spec` A2 | 段数口径统一为 **6+1 段（6 段主流程 + 1 段 `unknown`）** |
| `spec` 验收、`workbuddy.md` 8.4、`SKILL.md` §4.2 | 预算口径统一为：**不追问，只告知默认 `null`**；用户改口后带 `--budget` 重跑 |
| `docs/adr/0006`、`research/04` | 删掉具体出口 IP，只留「CN / US 出口」描述 |

**自查**：脚本扫 `examples.md` 里所有「简单麦」发言——每行问号 ≤ 1、过敏与口味词零同句、无「过敏记忆」暗示，问题数 **0**。

### 8.8 A2.3 补丁：过敏改为「首次一次 + 本机记忆」（2026-10-22 23:36）

**动机**：A2.1 要求"每个会话都问一次过敏"，对熟客太啰嗦，也显得没记住人。改为：**首次问一次并说明只存本机；之后靠本地记录，不再问。**

| 文件 | 改动 |
|---|---|
| `memory/health.json` | 新增（**本机文件，未入库**）：`{ allergyKnown, allergens, confirmedAt }`，初始 `unknown` |
| `.gitignore` | 在 `memory/` 之外**再加一条 `memory/health.json`**，即使以后放开目录也不许提交 |
| `SKILL.md` §4.1 | 从"每会话一次"改为状态表驱动：`unknown`/无记录 → 问一次并说明"只记本机、可随时删"；`none`/`known` → 不问；变了/清空/冲突 → 轻确认一次 |
| `SKILL.md` §7 | 两个本地文件分工：`profile.json`（口味，A3 读写）、`health.json`（过敏，A2 直接读写、仅本机）；明确不主动提"我记得你过敏" |
| `SKILL.md` §10 | 新增硬边界：**JEV state 不含过敏信息**；`allergens` → `--avoid` 在本地过滤，judge 只见过滤后的候选 |
| `belief-schema.md` | §2.1 五条规则重写（何时问）；§7 闸门改为"unknown 且无记录才问"；§8 拆成 8.1 `profile.json` / **8.2 `health.json`**（字段表 + 读写规则 + 硬边界） |
| `examples.md` | 段 1 首次问 + 一句"只记本机、可随时删"；**段 6 第二次来不再问过敏、也不提"过敏"二字**；段 6 注明 `none`/`unknown` 两种走向 |
| `spec` A2 范围 | 补 `memory/health.json` 一行 + 过敏确认口径 + 「不做」改为 `profile.json` 落盘 |

**状态机（实测，23:35）**

| 本机状态 | 行为 | 实测输出 |
|---|---|---|
| 无文件 / `unknown` | 先问一次 | `health=unknown → 先问一次过敏` |
| `none`（用户答"没有"后写入） | 不再问 | `health=none → 不再问，直接用` |
| 用户说"都清掉"→ 删记录 | 下次重新问 | `health=missing → 先问一次过敏` |
| `known`（含过敏原） | 不问，`allergens` 当 `--avoid` 传 | 同 `none`，额外带排除词 |

**验收对照**

| 验收项 | 结果 | 证据 |
|---|---|---|
| 第一次问一次 | ✅ | 段 1；问句里带"只记本机、可随时删" |
| 第二次不问 | ✅ | 段 6 **对白里没有"过敏"二字**，直接揭晓（只有注释在讲规则） |
| clear 后再次问 | ✅ | 删除 `health.json` 后判定回到 `missing → 先问一次` |
| 仓库无过敏原/健康信息 | ✅ | `git check-ignore -v memory/health.json` → 命 `.gitignore:21`；`git status memory/` 无输出；`git grep allergens` 只命中文档 schema，无任何真实过敏原数据 |
| JEV 请求体无 allergens | ✅（当前无 judge.mjs） | `scripts/` 里除一句"JEV 的活（A3）"注释外，`allergens`/`allergyKnown` 零命中；契约写进 SKILL §10 与 belief-schema §8.2，A3 写 `judge.mjs` 时按此执行 |

**边界（交给 A3）**：`judge.mjs` 还没写，所以"请求体不含 allergens"目前靠契约约束 + 代码层不接触过敏信息来保证；A3 落地时必须在 state 组装处只取候选（餐名/价格/类型），不读 `health.json`。

---

## 九、A3 记录：揭晓 + 记忆 + JEV judge（2026-10-23 11:05，Builder）

> 只写 `meal-skill/`；**没改** `scripts/mcp.mjs` / `scripts/candidates.mjs` / 数据层。

### 9.1 交付

| 文件 | 内容 |
|---|---|
| `scripts/judge.mjs` | JEV 裁判：候选 + belief → 一次请求（1 choice + 每组 1 score + 1 noul）→ 决策；`--health`；代理自重拉；`--dry-run` 打印请求体（不含 key） |
| `scripts/memory.mjs` | `read` / `update --json` / `clear [--target]`；profile 与 health 分文件；原子写；PII 字段拒写 |
| `skills/easy-eat/SKILL.md` | §8 选组改为调 judge（~~失败静默回退~~ **已被 A6.1 取代**：失败即不推荐）；§7 改为用 memory.mjs；§10 边界；§12 自检加"跑没跑 judge" |
| `docs/specs/0001-easy-eat.md` | 新增 A3 范围与验收；"未做"只剩 UI / 真实下单 |

### 9.2 JEV 接入时的四个真坑（都是实测出来的）

1. **question 的说明字段叫 `instructions`，不是 `prompt`**：用 `prompt` 会 400「needs instructions」。
2. **`choice` 的 `criteria` 必须是对象 map**（`{"steady_1":"稳妥：…"}`）；传数组会一直报「needs criteria with at least 2 options」。
3. **问题名/选项名只接受短标识符**（字母/数字/下划线）：候选 id `steady-1` 直接当问题名会 422，得转成 `steady_1`（`safeKey()`）。
4. **`score` 的 `criteria` 是 2–10 个有序等级数组**（返回 `score` 为浮点、`legend` 给回等级）。

**额外发现**：把"赶时间→轻 / 累→稳妥 / 犒劳→奖励"的判断依据写进 `choice.instructions` 之后，同一份候选的置信度从 **0.43–0.55** 升到 **0.77**，选组也从"稳妥"纠正成"轻"——**JEV 需要被告知判断标准，不能只丢状态**。

### 9.3 真实跑（2026-10-23 10:55–11:03）

> **第 3、4 行已被 A6.1 取代**：当时低置信、网络失败都回退到规则选组并 exit 0；现在同样的情形 judge 返回 `recommended=false`、`chosenId=null`、`exit 2`，不推荐（见第十二节 12.1）。第 1、2、5 行（JEV 正常时）仍成立。

| # | 命令要点 | 结果 |
|---|---|---|
| 1 | `judge.mjs --health` | `enabled=true`、`model=jev-1.14.0`、`latencyMs=2295`、`usage=302/20`、proxy 生效 |
| 2 | 到店候选 + `{"timePressure":"high","fullness":"light"}` | `provider="jev"`、`chosenId="light-2"`、`chosenType="轻"`、`confidence=0.77`、`violatesHard=0.07`、`usage=1180/116` |
| 3 | 到店候选 + `{"mood":"low"}` | `confidence=0.43` → `fallbackReason="low_confidence"`，回退到 `steady-1`（稳妥），**不报错** |
| 4 | `JEV_PROXY=http://127.0.0.1:1` | `provider="fallback"`、`fallbackReason="network"`、`attempts=2`、**exit 0** |
| 5 | 外送候选 + `{"mood":"high","fullness":"heavy"}` | `provider="jev"`、`chosenId="reward-3"`、`chosenType="奖励"`、`confidence=0.73`、`usage=1170/116` |

### 9.4 记忆（真实读写）

| 步骤 | 结果 |
|---|---|
| `update` 写 profile（taste/usual/rejected/budgetBand/byWeekday/recentChoices） | `wrote=["profile"]` |
| `update --json '{"allergyKnown":"none"}'` | `wrote=["health"]`，`confirmedAt` 自动补 |
| `update --json '{"allergyKnown":"known","allergens":["花生"]}'` | 写入成功，`confirmedAt=2026-10-23T10:58:04+08:00` |
| `read` | 两个文件都在，字段正确 |
| `clear --target health` | `removed=["health"]`，**profile 仍在** |
| `clear` | 两个都删；再写回 `unknown` 作为初始态 |
| `update --json '{"phone":"<11 位号码>"}'` | **拒写**，exit 2：「字段「phone」属于个人/位置信息」 |

### 9.5 隐私取证

- `judge.mjs --dry-run` 的请求体（1.8KB）里：`花生` / 一个测试地址 / `<11 位号码>` / `addressRef` / `allergens` / `phone` **全部 0 命中**（⚠ **该测试当时没有把敏感内容放进 `quotes`，所以没覆盖到 `quotes` 这条外发通道；P0-3 发现 `quotes` 当时原样外发，已修复并重测，见 12.5**）——`buildState()` 只取 `mood/fullness/taste/timePressure/novelty/people/budget/mode/quotes` + 候选（id/type/餐品/价格/why）。
- 即使 `--belief-json` 里硬塞 `allergens`/`address`/`phone`，也进不了 state（白名单外直接丢弃）。
- 仓库内无 key：`grep "Bearer [A-Za-z0-9_-]{20,}"` 零命中；judge 只从 `JEVMODEL_API_KEY` 或 `~/.jevmodel/api_key.txt` 读，错误信息会抹 key。

### 9.6 已知边界

> **第 2、3 条已被 A6.1 取代**：低置信时不再「靠本地映射兜底」，健康检查失败时调用方也不再「静默回退」，而是不推荐并告知（第十一节 11.3）。

- JEV 只按"choice + noul"决策，`fits`（score）只作为证据记录，不参与判定——实测里 score 排名和 choice 经常不一致，score 噪声偏大。
- 置信度门限 0.55 是拍的，三组候选下 JEV 有时给 0.4–0.5；此时靠本地映射兜底，结果仍然可用但解释力弱于 JEV 高分的情况。
- 健康检查失败时**不伪造 200**：如实输出 `enabled=false` + reason，调用方静默回退。

---

## 十、A3.1 记录：券接进候选与算价（2026-10-23 19:10，Builder）

> 只写 `meal-skill/`；**没改** `judge.mjs` 的决策逻辑、没碰聊天层；不领券、不绑券、不下单。

### 10.1 改了 4 个文件

| 文件 | 改动 |
|---|---|
| `scripts/mcp.mjs` | 只读封装 `queryStoreCoupons`（`storeCode` + `orderType` + `beType`，外送带 `beCode`）；CLI `coupons` 只打标题/有效期/适用商品码，**券码与券 ID 不打印**，且不进 `--out` |
| `scripts/candidates.mjs` | `--coupons auto`（默认关）；候选定完 → 查门店券 → 命中项套券重算 → 预算改用券后价判断；新增 `coupon` 字段与 `filters[coupons]`、`summary.coupon` |
| `skills/easy-eat/SKILL.md` | §0.1 两条原则、§6 `--coupons auto`、§8 券只一句、§10 边界 |
| `README` / `MCP_INTEGRATION` / `spec` | 券的真实行为；删掉"券算完"这类提前承诺 |

### 10.2 券是怎么接的（顺序很重要）

```text
候选定完（无券算价 + 可售校验）
  → query-store-coupons（storeCode + orderType + beType [+ beCode]）
  → productCode 命中候选 items 才套券，只给那一个 item 传 couponId/couponCode
  → 重新 calculate-price，展示价只取 data.price
  → 预算按券后价判断（券把某组拉回预算内就保留，类型不变）
```

- 不换类型、不加商品、不组合多张券（同一商品只取第一张券）。
- 券专属 SKU：无券 `price=0` 且 `productList` 为空 → 直接 `rejected`（reason「券专属商品（无券不可售）」）。
- `savingsCents = 券后 discount − 券前 discount`（两个都是返回字段，未手算）。

### 10.3 实测（2026-10-23 18:58–19:08）

**算价层（同一门店 1960216）**

| 商品 | 无券 | 带券 | 差 |
|---|---|---|---|
| `1440` 麦辣鸡腿汉堡 ×1 | `price=2250`、`discount=0` | `price=1190`、`discount=1060` | 省 ¥10.60 |
| `9900016534` 王牌炸鸡任选2 ×1 | `price=0`、`productList` 空 | `price=1990`、`discount=390` | 券专属 SKU |

**候选层**

| 场景 | 结果 |
|---|---|
| 1960216 到店，`--coupons auto` | 扫 2 张券、命中 0（券只覆盖 1440 与 9900016534，而三组候选是套餐/其他单品）→ 价格不变 3450 / 2800 / 6430，全部 `coupon.applied=false` |
| `--avoid 套餐 --coupons auto`（不吃套餐 ⇒ 轻组=1440+玉米杯） | **券命中**：券前 3550 → 券后 2490，`savingsCents=1060`，`title=11.9元麦辣鸡腿堡`；稳妥/奖励仍是 `applied=false` |
| 外送 `--mode delivery --coupons auto` | `query-store-coupons` 带 `beCode` 正常返回（扫描 2、命中 0），价格 4890 / 4380 / 7170 不变 |
| 反向测试：用户要「轻」，券只在别组 | 正常场景下 0 命中 ⇒ 轻仍 2800、`coupon.applied=false`、没有任何"券后"字段；judge 仍选 `light-2`（confidence 0.95） |

**judge 侧**：对券后候选跑一次 → `provider=jev`、`chosenId=light-2`、`chosenType=轻`、`confidence=0.86`；`--dry-run` 请求体里 `coupon` / `券` / `1190` / `2490` **全部 0 命中**。

### 10.4 隐私取证

- 三份 `candidates*.json`：`couponCode` / `couponId` **0 命中**；`MCD[A-Z0-9]{6,}` 0 命中。
- 调用日志里券只以 `1440×1·券` 这种形式出现（标"券"，不带码）。
- 仓库 `git grep "MCD[A-Z0-9]{8,}|Bearer [A-Za-z0-9._-]{20,}"` 零命中。

### 10.5 已知边界（如实）

1. **这家店的券与三组候选天然不匹配**：券只覆盖 `1440` 与券专属 SKU `9900016534`，而规则选出来的三组是套餐/其他单品。按"券不改变决定"，`--coupons auto` 在默认场景下就是 0 命中；命中案例要靠"不吃套餐"这种真实偏好才会出现。
2. **券查询失败路径没有真实触发过**（MCP 一直正常）：代码里 `couponsRes.ok=false` → `filters[coupons]` 记原因、价格全按原价；这条只做了代码审阅。
3. **券专属 SKU 无法从菜单自然选中**（它不在 `query-meals` 里），所以"0/空不进候选"的拒绝分支靠规则 + 代码保证，没有真实触发样本。
4. 没有做券组合优化、跨店比价、领券/绑券/下单——都是明确不做的范围。

---

## 十一、A6 记录：可靠优先 + 详情/图片 + 延迟 + JEV 硬门槛（2026-10-24 15:20）

### 11.1 改了哪些

| 文件 | 改动 |
|---|---|
| `skills/easy-eat/SKILL.md` | 新增 §0.2 可靠优先、§0.3 JEV 硬门槛、§6.0 顺序与延迟预算、§6.1 health、§6.4 详情、§8 图/卡与"不降级"、§9 两行兜底、§12 七条新自检 |
| `skills/easy-eat/references/examples.md` | 段 3 明写"累 ≠ 送"；补三条可靠性硬错反例 |
| `skills/easy-eat/references/belief-schema.md` | `mode` 只认 `user_said`，**禁止 `inferred`**；"累/懒/远"不算配送 |
| `scripts/detail.mjs` | **新增**（只读透传 `query-meal-detail`），不算价、不选品 |
| `README` / `MCP_INTEGRATION` / `spec` | 改成"JEV 必需"，删掉"静默回退" |
| `scripts/judge.mjs` | **A6 只改注释**（说明 fallback 是离线自测）；**A6.1 在 `main()` 出口加 strict 硬门槛 + `exit 2`**（见 11.3） |

### 11.1.1 A6.2 修审查问题

| 问题 | 改法 |
|---|---|
| README 还在说"没有 key / 超时 / 地区不可用时自动回退，不阻塞" | 改成"JEV 是必需裁判；无 key/超时/451 → judge exit 2，不给方案；会话开始先跑 `--health`"，全文只剩 `--allow-fallback` 一处 fallback |
| ADR 0004 / 0006 还写着"走安全默认" | 两条头部各加一行"⚠️ 2026-10-24 A6.1 起：JEV 回退档废止"，旧条目划掉；0006 补"451 已用代理解决，但代理仍是运行前提" |
| `detail.mjs` 外送错配（MAJOR） | `pickTarget` 带出 `report`，新增 `resolveFulfillment()` 读 `fulfillment.orderType/beType`，外送再兜 `calls[].args.beCode`；请求带 `orderType=2 / beType=2 / beCode`。实测 9900002995：到店口径 `ok=false`（未匹配到商品），外送口径 `ok=true`（3 轮组成） |
| `--require-jev` 是 no-op | 按推荐方案 a 删掉：usage、头注释、SKILL 命令、README、MCP_INTEGRATION 全部去掉，只留"默认严格" |
| 图片域名不校验 | `safeImage()`：不是 `https://menu-img.mcd.cn/` 前缀一律 `null` |
| workbuddy 11.1 说法不准 | 拆成"A6 只改注释 / A6.1 加 exit 2"，并补 no_key 与 --allow-fallback 的实测 JSON |

### 11.2 detail 实测字段（2026-10-24，门店 1960216）

| 商品 | `canSwap` | 组成 | `image` | `detailUrl` |
|---|---|---|---|---|
| 9900004064 精选单人餐三件套 | true（主食 5 选 1、小食 5 选 1、饮料 **25 选 1**） | 3 轮 | `menu-img.mcd.cn/...MS_9900004064_600.png` | **不存在** |
| 9900011128 “堡”你欢乐套餐 | true（饮料 6 选 1） | 4 轮 | 有 | 不存在 |
| 1440 麦辣鸡腿汉堡 | **false**（单品无轮次） | 0 | 有 | 不存在；但 `canModify=true`（可加/去 2 种料） |

- 所以"饮料能选的话"这句可以被替掉：**套餐的饮料那轮真有 25 个选项，直接说"饮料 25 选 1"**；单品就说"没得换"。
- `detailUrl` 实测没有 → SKILL 明确写"不提详情链接"。

### 11.3 JEV 从"可选"改成"硬门槛"

- 会话开始跑 `--health`；不通 → 不查门店、不给方案，只给 key/代理修复指引。
- 只有 `provider="jev"` 才揭晓；judge 现在**默认严格**：拿不到判断就 `exit 2`、`chosenId=null`。
- **A6 只改注释；A6.1 在 `main()` 出口加了 strict 硬门槛**：

```js
const strict = !options['allow-fallback'];
if (strict && decision.provider !== 'jev') {
  decision.recommended = false;
  decision.strict = true;
  decision.chosenId = null;
  decision.chosenType = null;
}
return strict && !decision.recommended ? 2 : 0;
```

**no_key 实测（严格，`USERPROFILE` 指到空目录）→ exit 2**

```json
{
  "enabled": false, "provider": "fallback",
  "chosenId": null, "chosenType": null,
  "fallbackReason": "no_key",
  "recommended": false, "strict": true
}
```

**no_key + `--allow-fallback`（仅排障）→ exit 0**

```json
{ "chosenId": "steady-1", "fallbackReason": "no_key", "recommended": false, "debugOnly": true }
```

- 注意 `recommended` 在排障模式下**仍是 false**：exit 0 只代表"命令跑完了"，不代表"可以推荐"。

### 11.4 延迟（实测一次全链）

```text
health 5.3s → 问过敏（0 调用）→ candidates 3.1s → judge 5.5s → detail 2.0s = 16.0s
```

- 首条响应只问过敏，**不等任何接口**（之前 1m36s 主要花在"每轮重跑候选 + 读一堆文档"）。
- SKILL 写死：候选/详情/health 一个会话各一次，换只换下一组。

### 11.5 已知边界

1. 详情接口偶发 4s+（第一次 4145ms，后来 795ms），所以只查最终一组，别查三组。
2. 图片只有官方 `menu-img.mcd.cn` 一个来源；没有图片字段时退一行卡（示例里省略图片）。
3. `composition` 最多只念一两项，全念会变成报菜名。

---

## 十二、A6.1 / A6.2 / A6.3 证据（2026-10-24 17:10 补录，P0-1）

> 这一节只补证据，不改代码。每个提交的说明在 `git show <hash>`；下面是 2026-10-24 在 HEAD `a34d8a9` 上**重新实跑**的结果（不是照抄提交说明）。环境：Windows 10.0.26200，Node v24.21.0，JEV 经 `127.0.0.1:7897` 代理。

### 12.1 A6.1（`cd93d72`）JEV 变成代码级硬门槛

| 场景 | 命令要点 | 实测 |
|---|---|---|
| JEV 正常 | `judge.mjs --candidates data/candidates.json --belief <文件>` | **exit 0**，`provider=jev`，`recommended=true`，`chosenId=light-2`，`confidence=0.77`，`violatesHard=0.07`，`latencyMs=2918`，`strict=true`，`debugOnly=false` |
| 网络不通 | 同上，`JEV_PROXY=http://127.0.0.1:1` | **exit 2**，`provider=fallback`，`fallbackReason=network`，`chosenId=null`，`recommended=false`，`strict=true` |
| 无 key | `USERPROFILE` 指到空目录 | **exit 2**，`fallbackReason=no_key`，`chosenId=null`，`recommended=false`，`strict=true` |
| 无 key + `--allow-fallback` | 仅排障 | exit 0，`chosenId=steady-1`，但 **`recommended=false`**（`debugOnly=true`），不能当推荐用 |
| 健康检查 | `judge.mjs --health` | exit 0，`provider=jev`，`model=jev-1.14.0`，`latencyMs=1749` |

提交说明另记：把 `CONFIDENCE_MIN` 临时调到 0.99 的临时副本也得到 `exit 2`、`fallbackReason=low_confidence`。**这一条本次没有重跑**，沿用提交说明，标注为"未复验"。

### 12.2 A6.2（`e552352`）外送详情口径 + 删 no-op + 清回退措辞

- 外送候选的 `query-meal-detail` 必须带 `orderType=2 / beType=2 / beCode`；`detail.mjs` 从候选文件的 `fulfillment` 读取，缺 `beCode` 则退出 2，不静默退回到店。
- 提交说明记录的实测：商品 `9900002995`，到店口径 `ok=false`（未匹配到商品），外送口径 `ok=true`（3 轮组成）。**这一条需要 MCP Token，本次环境未设 `MCD_MCP_TOKEN`，没有重跑实时调用**，沿用提交说明，标注为"未复验"。
- 已复验的离线部分：外送候选缺 `beCode` 时 `detail.mjs` exit 2，错误信息"这是外送候选，但拿不到 beCode"。
- `--require-jev` 是 no-op，已删；只剩"默认严格"。图片只放行 `https://menu-img.mcd.cn/` 前缀。

### 12.3 A6.3（`a34d8a9`）矛盾履约参数一律拒绝

本次实跑（`detail.mjs`，不需要 Token，因为在发请求之前就被拒）：

| 输入 | 实测 |
|---|---|
| 外送候选文件 + `--mode pickup` | **exit 2**，"`--mode=pickup` 与候选文件的履约方式（delivery）冲突" |
| 到店候选文件 + `--mode delivery` | **exit 2**，"`--mode=delivery` 与候选文件的履约方式（pickup）冲突" |
| 外送候选文件 + `--order-type 1` | **exit 2**，"orderType=1 与 beType=2 不自洽" |
| 手工 `--mode delivery` 且无 beCode | **exit 2**，"这是外送候选，但拿不到 beCode" |

提交说明另记 3 条正常路径（到店 0、外送 0、手工 0），需要 Token，**本次未复验**。

### 12.4 本节没有验证的部分

- 需要 `MCD_MCP_TOKEN` 的实时 MCP 调用（`candidates.mjs`、`detail.mjs` 正常路径）。
- 低置信分支（需改阈值的临时副本）。

### 12.5 P0-3：`quotes` 外发过滤（2026-10-24）

**发现**：`judge.mjs` 的 `buildState()` 把 `belief.quotes` 前 4 条原样发给境外 JEV。9.5 的隐私取证没有把敏感内容放进 `quotes`，所以当时的"0 命中"没覆盖这条通道。

**修复**：新增 `sanitizeQuotes()`，含过敏/忌口/病史、门牌/地址、电话/邮箱的整句直接丢弃（不打码），其余最多留 4 条、每条 60 字。README 与 MCP_INTEGRATION 披露外发内容，SKILL 要求这类话一开始就不放进 `quotes`。

**验收（`--dry-run`，只打印请求体、不发送；belief 里还硬塞了 `allergens=["花生"]` 与 `addressRef`）**：

| 输入 `quotes`（共 16 条，含 10 条敏感：过敏、住址+门牌、送到某校东门、手机号 ×2、乳糖/牛奶不耐受、鱼不能吃、糖尿病、邮箱） | 实际外发 |
|---|---|
| 敏感句 | 全部丢弃 |
| `今天累死了` / `不想走路，想快点吃` / `下午还要开会，别太撑` / `想吃点热的` | 保留 |
| `我爱吃鱼` / `吃点清淡的` / `今天加班到九点`（单测） | 保留（没有误伤） |

请求体（3010 字节）里 `花生` / `过敏` / `光谷` / `华中农业` / `1381` / `@` / `addr#` / `allergen` / `不耐受` / `糖尿` / `牛奶` / `502` **全部 0 命中**；`state` 顶层键只有 `task,now,people,budgetYuan,mode,user,quotes,candidates`。

真实 JEV 回归：`quotes=["我花生过敏，累死了","今天累死了","我住在光谷大道88号"]` → `provider=jev`，`chosenId=steady-1`，`recommended=true`，exit 0（过滤不影响正常判断）。

**没有验证 / 已知局限**：过滤是关键词规则，不保证覆盖所有说法（例如不带关键词的隐晦表达）；因此 SKILL 同时要求不把这类话放进 `quotes`。

### 12.6 P0-4：已知过敏原的详情核对（2026-10-24）

**问题**：`--avoid` 只按菜单文字匹配；选定一组后，套餐里可换的小食/饮料、加减料里的过敏原没人看，`detail.mjs` 输出的 `options` 还截断到 5 项。

**修复**：新增 `scripts/allergen.mjs`（`scanAllergens` / `readHealth`），`detail.mjs` 在截断**之前**对完整的商品名、各轮全部 `choices`、`modification` 全部选项比对，输出 `allergenCheck{status,hits,statement,scope}`。过敏原取自本机 `memory/health.json`，或 `--allergens 花生,虾`。状态：`conflict-fixed`（换组）/ `conflict-swappable`（避开或换组）/ `hit-addon-only` / `no-hit-name-only`（只说“只核对了菜名和选项名”）/ `unknown-not-scanned`（状态未知，不核对、不当成没有）/ `none-not-scanned`。任何状态都不输出“安全”类措辞。SKILL §6.4 与 README 已同步。

**验收**：
- `node --test scripts/allergen.test.mjs`：10 条全过（商品名命中、固定一轮命中、可换一轮部分/全部命中、第 7 项命中（截断后会漏的位置）、加料命中、无命中不出现“安全/放心/不含”、unknown/none、`readHealth` 缺文件/坏 JSON/known 无过敏原 → unknown）。
- 端到端：用本地 mock MCP（`127.0.0.1`，临时脚本，已删）跑 `detail.mjs`：`--allergens 花生` → `conflict-swappable`，命中 `花生脆`（它在第 7 项，输出的 `options` 只有 5 项，仍被扫出）；`--allergens 麦辣` → `conflict-fixed`；`--allergens 虾` → `no-hit-name-only`，statement 只有“只核对了菜名和选项名…不构成安全保证”；不带参数且无 health.json → `unknown-not-scanned`。

**没有验证**：没有 `MCD_MCP_TOKEN`，**没跑真实 `query-meal-detail`**；`rounds` / `modification` 的结构取自 `detail.mjs` 既有解析（A6.2 实测），mock 夹具是按该结构手写的，不是真实返回。关键词是子串匹配，同义词（如“坚果”vs“花生”）、配料表、交叉接触都覆盖不到。