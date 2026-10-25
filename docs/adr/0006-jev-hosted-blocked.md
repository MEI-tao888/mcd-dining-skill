# Hosted JEV 需要走本地代理；直连 451

> ⚠️ 2026-10-24 A6.1 起：JEV 回退档废止；JEV 为必需裁判，失败不给方案。
> 451 已通过本地代理解决，但**代理仍是运行前提**：没有代理就没有 JEV，也就没有推荐。

- 时间：2026-10-22 22:50（北京时间）
- 事实：
  - jevmodel key 已创建，余额 100,000 input tokens；
  - **直连** `https://jevmodel.org/v1/systemone`：502 / 上游 451 `Typesafe is not available in your region`；
  - **官方** `https://api.typesafe.ai/v1/systemone`（无 auth）：同样 451；说明不是 jevmodel 独有；
  - 通过本机 Clash 代理 `http://127.0.0.1:7897`：Cloudflare trace `loc=US`，JEV 返回 **200**（`jev-1.14.0`）；
  - 完整请求（choice + 3 score + noul）返回 200，`pick=steady`，`confidence=0.92`，usage `input_tokens=1115`。
- 原因：**终端/Node 的出口仍是 CN**（Cloudflare trace 显示 `loc=CN`）；`ipinfo` 显示美国是因为不同路由，不能代表 API 的出口。全局 VPN 没有覆盖 DSH/Node 进程；不是网站、不是 key、不是调用方式的问题。
- 方案：
  - `judge.mjs` 支持 `JEV_PROXY`（默认 `http://127.0.0.1:7897`）；
  - 有代理：调 hosted JEV（一次请求 2–3 组候选）；
  - ~~无代理/超时/451：回退到 LLM/规则默认，不阻塞 demo~~ —— **已废止（见顶部）**：
    现在 `judge.mjs` 默认严格，拿不到 JEV 就 `exit 2`、`chosenId=null`，**不给方案**；
  - 代理是**运行前提**：演示前先 `node scripts/judge.mjs --health`，必须 `enabled=true`；
    评委网络不同也一样——没有代理就不推荐，而不是降级。
- 成本：100k 免费 tokens；完整请求 ~1115 input tokens，约 89 次；demo 足够。

Status: accepted（2026-10-22）
