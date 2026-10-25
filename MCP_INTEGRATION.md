# MCP 接入说明

本文件说明项目实际使用的麦当劳 MCP Server、Tool、调用流程与业务价值（参赛必交文件）。

## 1. 使用的 MCP Server

| 项 | 值 |
|---|---|
| Server 名称 | 麦当劳 MCP 服务（McDonald's China MCP） |
| 接入地址 | `https://mcp.mcd.cn` |
| 传输协议 | Streamable HTTP |
| 鉴权方式 | 请求头 `Authorization: Bearer ${MCD_MCP_TOKEN}`（Token 仅存环境变量，不入库） |
| 限流 | 600 次/分钟/Token；401 无效，429 超限 |

## 2. 使用的 Tool 清单

| Tool | 用途 | 在流程中的位置 |
|---|---|---|
| `query-nearby-stores` | 查询附近可用到店门店（含营业状态/营业时间） | 定位门店 |
| `delivery-query-addresses` | 查询本机账号已保存的外送地址（只取 `addressRef`，不落盘） | 外送前置 |
| `delivery-query-stores` | 按地址查可配送门店（`beType=2`） | 外送定位门店 |
| `query-meals` | 查询当前门店可售菜单（`orderType=1` 或 `2`、外送传 `beCode`） | 拉取菜单 |
| `query-store-coupons` | 查门店 × 订单类型可用券（只读；券码只用于当次算价） | 算价前 |
| `calculate-price` | 权威算价：商品价、配送费、打包费、优惠、应付总价；券要显式传 `couponId` + `couponCode` | 算价 |

未使用：`query-meal-detail`、`list-nutrition-foods`、`create-order`（本次不做到营养明细与真实下单；写操作不在黄金路径）。

## 3. 调用流程

```text
用户输入（一句话 / 情绪 / 人数 / 预算 / 口味 / 忌口）
  ↓
[1] 对话层：维护 belief state（硬字段/软字段），静默预取
  ↓
[2] query-nearby-stores / delivery-query-addresses + delivery-query-stores
  ↓
[3] query-meals（到店 orderType=1；外送 orderType=2 + beCode）
  ↓
[4] 本地硬筛 → 2–3 组候选（不做加权评分、不做排序）
  ↓
[5] calculate-price（逐组权威算价）
  ↓
[6] query-store-coupons + calculate-price（--coupons auto 时才查；
    只给命中商品套券重算；没命中就停在无券价；不换类型、不加商品、不组合券）
  ↓
[6.5] judge.mjs --health（会话开始一次；不通就不点餐）
  ↓
[7] judge.mjs：在 2–3 组里做最后判断（**必需裁判**，默认严格；exit 2 = 不推荐、
    `chosenId=null`，不做规则降级；`--allow-fallback` 只给离线排障）
  ↓
[7.5] detail.mjs：只查最终那一组（套餐组成 / 能否换 / 图片；没有就退一行卡）
  ↓
[8] 只揭晓一份：门店 + 套餐 + 价格 + 一句为什么 + 一个“换”的出口
```

## 4. 业务价值

- **省的不是钱，是注意力**：把“查门店、看菜单、比价格、算券、做决定”压缩成聊两句 + 一份；
- **只给一份**：反选项过载，减少决策疲劳；
- **合状态**：把心情、能量、时间压力、预算一起纳入，而不是只推“最便宜/最健康”；
- **券不改变决定**：有适用券就顺手用上，没适用券绝不为了券换用户想吃的类型；
- **必须依赖 MCP 实时数据**：门店营业状态、菜单、价格、券都是动态的，硬编码会立刻过期；
- **可解释**：理由引用用户原话，价格能指回 `calculate-price` 的 `data.price`。

## 5. 失败兜底

| 情况 | 处理方式 |
|---|---|
| 无可用门店 | 提示换地址/切换外送，不编造门店 |
| 外送无地址 / 超范围 / 无可配送门店 | 结构化 `NO_ADDRESS` / `NO_DELIVERY_STORE`，改按到店自取并告知 |
| 券查询失败 | 按无券继续算，候选与价格不受影响；在 `filters[coupons]` 留原因 |
| 券不命中 | 保持原价，不提“券后”；不换类型、不加商品 |
| 券专属 SKU 不带券 | `calculate-price` 返回 0/空 → 不进普通候选 |
| 预算无法满足 | 给出最接近方案 + 差额提示，不静默超预算 |
| JEV 不可用 / 超时 / 低置信 | `judge.mjs`（默认严格）返回 **exit 2**、`chosenId=null` → **不给方案**：说明判断服务没连上并给修复指引（key / 代理）；低置信最多再问 1 个问题重判 1 次，仍 exit 2 就收手。不降级成规则推荐 |
| 详情查不到（ok=false，重试一次仍失败） | **不给方案**：缺详情就是缺事实；不贴图、不猜套餐内容。只是"没有图片字段"时仍可揭晓，退成一行卡 |
| 429 限流 | 退避重试，避免频繁轮询 |

## 6. 安全与合规

- 仅使用环境变量占位符，不提交任何真实 Token、券码、手机号、地址；
- `data/*.json` 只保留脱敏后的门店/菜单/价格/`addressRef` 证据；
- 写操作（领券/下单/取消）必须由用户逐步确认；
- 过敏信息只存本机 `memory/health.json`，可清空，不发送给 JEV；
- 发给 JEV 的只有：对话摘要（心情/饱腹/口味/时间压力/新鲜感/人数/预算/取餐方式）、**过滤后**的用户原话（最多 4 条；含过敏/病史、地址/门牌、电话/邮箱的整句丢弃）、候选的 id/类型/餐品名/价格/说明；不含过敏与健康信息、地址、电话、Token、门店编号（`judge.mjs` 的 `sanitizeQuotes()`；`--dry-run` 可查看完整请求体）；
- 不采集、不存储用户手机号、地址、账号凭证。
