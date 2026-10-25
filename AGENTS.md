# AGENTS.md · 用餐赛道参赛仓库（共享契约）

> 本文件是这个仓库的**唯一契约**。读取方：DeepSeek Harness（项目根 `AGENTS.md`）、Codex（仓库 `AGENTS.md`）、WorkBuddy（兼容 `AGENTS.md`，并额外自动加载 `.codebuddy/rules/`）。
> 冲突顺序：系统 / 开发者 / 用户直指令 > 本文件 > 其他文档。
> 版本：2026-10-21 v1（对应赛事规则 v1.0）。

---

## 0. 项目与目标

- 项目名：**简单麦**（英文：**Easy Eat**）。
  - 简单麦 = 本次参赛产品名：**简单、清爽、聊几句就知道吃什么**；
  - Easy Eat = 长期品牌：未来可接其他门店 MCP，不绑定单一品牌。
- 参赛：**1024 切磋大会 · 用餐赛道**，同时参加**麦当劳程序员创意开发大赛**。
- 交付：**WorkBuddy Skill + 麦当劳 MCP**，公开 GitHub 仓库（六件套见 §2）。
- 一句话定位：**吃饭很重要，选饭可以很简单。**（EN: **Eat well. Choose easy.**）
  简单麦 Easy Eat：不填表、不比价、不纠结；聊两句，吃得刚刚好。
- 目标优先级：**① 跑通并合规提交 → ② 用餐赛道之星 → ③ 麦当劳前 100**。
- 当前阶段：**10-22 架构冻结点**。黄金路径 = 到店自取；外送 = 第二模式，与核心共用，底层同期写入。

---

## 1. 不可协商的硬约束

1. **真实调用 MCP**：`https://mcp.mcd.cn`，Token 只从环境变量读取；禁止硬编码菜单、门店、价格、券。
2. **价格只认 `calculate-price`**：展示总价/券后价时必须能指出对应返回字段；模型不做价格算术。
3. **写操作必须确认**：`create-order` / `cancel-order` / `auto-bind-coupons` / `draw-lottery` / `mall-*` 前，先展示"动作 + 门店 + 商品 + 金额 + 影响"，用户明确确认后才执行；一次确认只对应一次写操作。
4. **隐私零落盘**：任何文件、注释、日志、截图、`workbuddy.md` 中不得出现真实 Token、手机号、地址、他人信息；配置只用环境变量占位符。
5. **失败如实说**：Tool 无返回/超时/售罄/券失效时走兜底文案，**禁止编造**数据。
6. **合规红线**：不贬低麦当劳、不与任何其他品牌对比；不宣扬不健康饮食 / 暴食 / 浪费 / 拜金 / 博彩；素材必须有使用权，真人需授权。
7. **文件名不可改**：`README.md`、`CONTEST_DECLARATION.md`、`MCP_INTEGRATION.md`、`mcp-config.example.json`、`workbuddy.md`。
8. **仓库必须 Public**，创建时间在 2025-12-25 至 2026-10-25 之间。
9. **不引入数据库 / 账号体系 / 支付 / 复杂前端框架**；两天赛制，能跑优先。
10. **一切"完成"都要证据**：Tool 返回 JSON、终端日志、截图、`git diff`。没有证据就写"未验证"。

---

## 2. 目录结构

```
meal-skill/                        # ← 本仓库根（GitHub repo root）
├── AGENTS.md                      # 本契约
├── GLOSSARY.md                    # 领域术语（domain-modeling 增量维护）
├── README.md                      # 项目介绍 / 安装 / 使用示例 / 目标用户
├── CONTEST_DECLARATION.md         # 官方原文，一字不改
├── MCP_INTEGRATION.md             # Server / Tool / 调用链 / 业务价值
├── mcp-config.example.json        # 仅环境变量占位符
├── workbuddy.md                   # WorkBuddy 开发对话记录（增量、脱敏）
├── docs/
│   ├── adr/NNNN-<slug>.md         # 难逆转的决策（少而精）
│   └── specs/NNNN-<slug>.md       # 规格（to-spec 产物，Status: ready-for-agent）
├── .scratch/<feature>/issues/     # 步骤清单（to-tickets 产物，NN-<slug>.md）
├── skills/<skill-name>/
│   ├── SKILL.md                   # 参赛 Skill 本体（frontmatter: name/description/version/author）
│   ├── scripts/*.mjs              # 确定性逻辑（Node 22+，ESM）
│   ├── references/*.md            # 字段说明、示例数据
│   └── templates/*.md             # 输出模板（方案卡等）
└── .codebuddy/rules/00-project.md # WorkBuddy 自动加载的项目规则（与本文件同步）
```

---

## 3. 工作流（技能链）

> 每个技能都**只在用户明确点名时调用**，不自动触发。项目使用**本地 tracker**：规格进 `docs/specs/`，步骤进 `.scratch/`，不碰外部 issue 系统。

| # | 技能 | 输入 | 产物 | 完成条件 |
|---|------|------|------|----------|
| 1 | `grill-with-docs` | 方案/设计草案 | `GLOSSARY.md`、必要时 `docs/adr/` | 设计树前沿为空；用户确认理解一致 |
| 2 | `to-spec` | 会话上下文 + 代码 | `docs/specs/NNNN-<slug>.md` | 测试 seam 已与用户确认；`Status: ready-for-agent` |
| 3 | `to-tickets` | 规格/计划 | `.scratch/<feature>/issues/NN-<slug>.md` | 用户批准颗粒度与阻塞边 |
| 4 | `implement`（内部调 `tdd`） | 一个步骤/规格 | 代码 + 测试 + 提交 | 黄金路径跑通；seam 测试绿；类型/语法检查通过 |
| 5 | `code-review` | 固定基点 + 规格 | Standards / Spec 两轴报告 | 无阻断项，或已记录取舍 |
| 6 | `retro`（可选） | 本次改动 | 复盘笔记 | — |

**每次只推进一个前沿步骤**；不并行开多个功能。

### 3.1 固定的角色与步骤名（以后不再改）

| 名字 | 是什么 | 谁做 |
|---|---|---|
| **G** | 选题盘问（一次性，已完成） | DSH / WorkBuddy |
| **A** | Builder，写代码、跑 MCP | WorkBuddy |
| **B** | Reviewer，独立审查、挑错 | GLM 会话 / DSH |
| **A1** | A 的第一步：取数 + 候选 | WorkBuddy |
| **A2** | A 的第二步：聊天 + 状态（`SKILL.md`） | WorkBuddy |
| **A3** | A 的第三步：揭晓 + 记忆 + JEV | WorkBuddy |
| **说明书** | `docs/specs/0001-easy-eat.md`，给 A 看的一页纸 | DSH |

不再使用"票据 / 任务卡 / 五层架构"这些叫法；对外统一说"步骤 / 流程 / 说明书"。

---

## 4. 领域术语

先改 `GLOSSARY.md`，再写代码。术语只放"项目自己的词 + 一句话定义 + _Avoid_ 同义词"，不放实现细节。
若某决策"难逆转 + 未来读者会困惑 + 真有取舍"，才写 ADR；否则不写。

---

## 5. 编码规范

- **确定性 vs 生成式**：算价校验、约束求解、券组合比较、格式化 → `scripts/`；模型只做编排、解释、话术。
- **测试**：只在预先确认的 seam（公开接口）上测；不 mock 内部协作者；测试名用 `GLOSSARY.md` 的词。
- **依赖**：不提交 `node_modules/`；锁定文件可提交；不引入框架/数据库。
- **金额**：用整数分或字符串表示，避免浮点误差。
- **Tool 记录**：每次真实调用记下 tool 名、入参摘要、返回摘要，供 `MCP_INTEGRATION.md` 回填。
- **文本**：UTF-8；中文标点统一；文件末尾换行。

---

## 6. 工具分工

| 工具 | 负责 |
|---|---|
| **WorkBuddy** | 主实现（写代码、跑通）、增量导出 `workbuddy.md` |
| **DSH** | 规则守门、跑偏预警、评审模拟、提交前检查（C0—C6 检查点） |
| **Codex** | 可选：第二意见、长任务、代码审查交叉验证 |

开工前读 `AGENTS.md` + `GLOSSARY.md`；结束前更新 `workbuddy.md` 并附证据。

---

## 7. 截止与冻结

| 时间 | 动作 |
|---|---|
| 10-22 22:00 | 选题冻结 + 架构定稿 |
| 10-23 22:00 | MVP 跑通；六件套齐；仓库 Public；发麦当劳报名 Issue |
| 10-24 11:30 | 赛事站**赛道锁定**开放（保存「用餐」+ 一句话选题，锁定后不可改） |
| 10-24 | 到场；18:00 一分钟进度交流 |
| **10-25 12:00** | **开放提交**（窗口 12:00—16:00；前 300 件按首次提交时间） |
| **10-25 15:00** | **代码冻结**（停止开发、停止换人） |
| **10-25 16:00** | 赛事站提交截止（含海报） |
| **10-25 23:59** | 麦当劳 Issue 报名截止 |

---

## 8. 提交前自检（逐项打勾）

- [ ] `README.md` / `CONTEST_DECLARATION.md`（官方原文）/ `MCP_INTEGRATION.md` / `mcp-config.example.json` / 源码 / `workbuddy.md`
- [ ] `git grep -n "Bearer \|MCD_MCP_TOKEN=\|1[3-9][0-9]\{9\}"` 无命中（占位符除外）
- [ ] 有真实 MCP 调用返回截图/日志
- [ ] 演示录屏 ≤ 500 MB，H.264 mp4
- [ ] 海报已打印
- [ ] 麦当劳 Issue：≤1000 字、无图、无多余换行、地址非 Markdown 链接
- [ ] 赛事站字段：名称 / 一句话 / 仓库链接 / 赛道=用餐 / 工具=WorkBuddy+麦当劳 MCP / 开发对话记录

---

## 9. 变更管理

- 修改本文件 = 规则变更：必须在 `workbuddy.md` 记一条；若是难逆转决策，补一条 ADR。
- 不得静默改规则；不得绕过 §1。
