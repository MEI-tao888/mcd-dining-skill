# 外送作为第二模式，与到店自取共用核心

- 状态：accepted（2026-10-22）
- 背景：用户决定初赛前把外送写进底层，而不是最后补。
- 方案：`fulfillment.mode = pickup | delivery`，两种模式共用聊天、候选、JEV、揭晓；只替换「取数/算价」适配层。
- 外送链路：`delivery-query-addresses` → `addressId` → `delivery-query-stores`（`beType=2`）→ `storeCode + beCode` → `query-meals` / `calculate-price`（`orderType=2`、`beType=2`、传 `beCode`）。
- 价格：只认 `calculate-price`；配送费/打包费以返回字段为准，不手算。
- 预算：按含配送费/打包费的总额硬筛；超预算整组剔除。
- 隐私：`addressId`、联系人、电话、完整地址**不写仓库、不写日志、不写 data JSON**；只保留 `addressRef` 之类的本地引用。
- 兜底：无地址 / 超配送范围 / 无外送门店 → 结构化 `NO_ADDRESS` / `NO_DELIVERY_STORE`，自然回退到店自取；不编造。
- 不做：ETA 承诺、库存保证、外送券的复杂组合；券仍以 `query-store-coupons` 为准。
