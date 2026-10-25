#!/usr/bin/env node
/**
 * 最终候选的套餐详情（简单麦 · A6，只读透传）
 *
 * 只做一件事：对**已经选中的那一组**查一次 query-meal-detail，把能展示的字段原样交出来。
 * 不选品、不算价、不改候选；查不到就说查不到。
 *
 * 用法（在 meal-skill/ 下）：
 *   node scripts/detail.mjs --candidates data/candidates.json --id light-2
 *   node scripts/detail.mjs --candidates data/candidates.delivery.json --id steady-1
 *   node scripts/detail.mjs --store 1960216 --code 9900011128 [--mode delivery --be-code <码>]
 *
 * 履约参数（A6.2 修复）：
 *   **跟 candidates 走**——从 `report.fulfillment` 读 orderType / beType，外送还要 beCode
 *   （beCode 不在 JSON 顶层，回退到 `calls[].args.beCode`）。写死 orderType=1 会导致
 *   外送商品"未匹配到商品"（实测 9900002995：到店口径 ok=false，外送口径 ok=true）。
 *
 * 输出（stdout，纯 JSON）：
 *   { ok, code, name, image, detailUrl, canSwap, canModify, composition[], modifyGroups[],
 *     fulfillment{mode,orderType,beType,beCodePresent}, ms, error? }
 *
 * 字段来源（2026-10-24 实测）：
 *   image        → 官方菜单图，**只认 https://menu-img.mcd.cn/ 前缀**，其他一律 null
 *   rounds       → 套餐组成，每轮 { name, quantity, choices[] }；choices>1 才算"能换"
 *   supportModify→ 单品能不能加/去料（特制），不等于换品
 *   没有 detailUrl 字段 → 输出 null，不拼链接
 */

import fs from 'node:fs';
import path from 'node:path';
import { McpClient, queryMealDetail } from './mcp.mjs';
import { readHealth, scanAllergens } from './allergen.mjs';

/** 只放行官方图床，别的一律当没有（不热链来路不明的图）。 */
const IMAGE_HOST_PREFIX = 'https://menu-img.mcd.cn/';

function safeImage(url) {
  return typeof url === 'string' && url.startsWith(IMAGE_HOST_PREFIX) ? url : null;
}

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) options[key] = true;
    else {
      options[key] = next;
      i += 1;
    }
  }
  return options;
}

function pickTarget(options) {
  if (!options.candidates) return null;
  const file = path.resolve(String(options.candidates));
  const report = JSON.parse(fs.readFileSync(file, 'utf8'));
  const list = Array.isArray(report.candidates) ? report.candidates : [];
  const candidate = options.id
    ? list.find((item) => String(item.id) === String(options.id))
    : list[0];
  if (!candidate) throw new Error(`候选里没有 id=${options.id}`);
  const main = (candidate.items || [])[0];
  if (!main) throw new Error('该候选没有商品');
  return {
    report,
    storeCode: String(report.store?.storeCode || options.store || ''),
    productCode: String(main.productCode),
    candidateId: String(candidate.id),
    type: String(candidate.type),
  };
}

/** 配置错（--mode 与候选冲突、orderType/beType 不自洽…）：直接报错，不猜。 */
class ConfigError extends Error {}

/**
 * 履约参数要跟 candidates 走，不能默认到店。
 *
 * 原则（A6.3）：
 *  - `orderType` / `beType` 只由**显式参数或 report.fulfillment** 决定；
 *  - `isDelivery` 只由最终 `orderType` 推导，**不再看 options.mode**——否则会拼出
 *    "pickup + orderType=2 + beCode" 这种自相矛盾的组合；
 *  - `--mode` 只用来**校验**：和候选口径不一致就报错，不静默改参数。
 *
 * beCode 不在 JSON 顶层（只存了 beCodePresent），回退到 calls[].args.beCode。
 */
function resolveFulfillment(report, options) {
  const f = report?.fulfillment || {};
  const hasReport = Boolean(report?.fulfillment);

  const declared = options.mode ? String(options.mode).toLowerCase() : null;
  if (declared && !['pickup', 'delivery'].includes(declared)) {
    throw new ConfigError(`--mode 只能是 pickup 或 delivery，收到：${options.mode}`);
  }

  const explicitOrderType = options['order-type'] !== undefined ? Number(options['order-type']) : null;
  const explicitBeType = options['be-type'] !== undefined ? Number(options['be-type']) : null;
  const reportOrderType = f.orderType !== undefined && f.orderType !== null ? Number(f.orderType) : null;
  const reportBeType = f.beType !== undefined && f.beType !== null ? Number(f.beType) : null;

  // 没有候选文件时，才允许 --mode 提供默认值（手工查单品）
  const baseOrderType = reportOrderType ?? (declared === 'delivery' ? 2 : 1);
  const orderType = explicitOrderType ?? baseOrderType;
  const beType = explicitBeType ?? reportBeType ?? (orderType === 2 ? 2 : 1);

  // orderType 与 beType 必须自洽：1↔1、2↔2、5→1（得来速）、6→2（团餐）
  const expectedOrderType = beType === 2 || beType === 6 ? 2 : 1;
  if (![1, 2, 5, 6].includes(beType)) {
    throw new ConfigError(`--be-type 只能是 1/2/5/6，收到：${beType}`);
  }
  if (orderType !== expectedOrderType) {
    throw new ConfigError(
      `orderType=${orderType} 与 beType=${beType} 不自洽（beType=${beType} 应对应 orderType=${expectedOrderType}）`,
    );
  }
  if (![1, 2].includes(orderType)) {
    throw new ConfigError(`orderType 只能是 1 或 2，收到：${orderType}`);
  }

  const isDelivery = orderType === 2;
  const mode = isDelivery ? 'delivery' : 'pickup';

  // --mode 只做校验：和最终口径不一致就报配置错误，不静默拼参数
  if (declared && hasReport) {
    const reportMode = f.effectiveMode || f.requestedMode || null;
    if (reportMode && declared !== reportMode) {
      throw new ConfigError(
        `--mode=${declared} 与候选文件的履约方式（${reportMode}）冲突；不带 --mode 才会跟候选走`,
      );
    }
    if ((declared === 'delivery') !== isDelivery) {
      throw new ConfigError(
        `--mode=${declared} 与最终 orderType=${orderType} 冲突，拒绝生成自相矛盾的请求`,
      );
    }
  }

  let beCode = options['be-code'] ? String(options['be-code']) : null;
  if (!beCode && typeof f.beCode === 'string') beCode = f.beCode;
  if (!beCode) {
    const call = (report?.calls || []).find((entry) => entry?.args?.beCode);
    if (call) beCode = String(call.args.beCode);
  }

  return { mode, isDelivery, orderType, beType, beCode };
}

function summarizeRounds(rounds) {
  const list = Object.values(rounds || {}).filter((round) => round && typeof round === 'object');
  return list.map((round) => {
    const choices = (round.choices || []).map((choice) => choice.name).filter(Boolean);
    return {
      name: round.name || choices[0] || '一项',
      quantity: Number(round.quantity ?? 1),
      choices: choices.length,
      options: choices.slice(0, 5),
    };
  });
}

function summarizeModification(modification) {
  const groups = (modification && modification.items) || [];
  return groups
    .map((group) => {
      const values = (group.values || []).map((value) => value.name).filter(Boolean);
      return { group: group.name || '', count: values.length, options: values.slice(0, 5) };
    })
    .filter((group) => group.count > 0);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  let target = null;
  try {
    target = pickTarget(options);
  } catch (err) {
    console.log(JSON.stringify({ ok: false, error: err.message }, null, 2));
    return 2;
  }

  const storeCode = target?.storeCode || String(options.store || '');
  const productCode = target?.productCode || String(options.code || '');
  if (!storeCode || !productCode) {
    console.log(
      JSON.stringify(
        { ok: false, error: '需要 --candidates <json> --id <候选id>，或 --store <门店码> --code <商品码>' },
        null,
        2,
      ),
    );
    return 2;
  }

  // 履约口径跟候选文件走：外送必须 orderType=2 / beType=2 / beCode，否则查不到商品。
  let fulfillment;
  try {
    fulfillment = resolveFulfillment(target?.report, options);
  } catch (err) {
    // 配置错（--mode 冲突 / orderType 与 beType 不自洽）：报错退出，不静默拼参数
    console.log(JSON.stringify({ ok: false, code: productCode, storeCode, error: err.message }, null, 2));
    return 2;
  }

  if (fulfillment.isDelivery && !fulfillment.beCode) {
    console.log(
      JSON.stringify(
        {
          ok: false,
          code: productCode,
          storeCode,
          error: '这是外送候选，但拿不到 beCode（候选 JSON 里没有，也没传 --be-code）',
          fulfillment: { mode: fulfillment.mode, orderType: fulfillment.orderType, beType: fulfillment.beType },
        },
        null,
        2,
      ),
    );
    return 2; // 缺 beCode 是配置错误，不能静默退回到店
  }

  const client = new McpClient({});
  const startedAt = Date.now();
  const result = await queryMealDetail(client, {
    storeCode,
    code: productCode,
    orderType: fulfillment.orderType,
    beType: fulfillment.beType,
    // 到店自取不传 beCode；外送/得来速/团餐必须传
    beCode: fulfillment.orderType === 2 ? fulfillment.beCode || undefined : undefined,
  });
  const ms = Date.now() - startedAt;

  const fulfillmentOut = {
    mode: fulfillment.mode,
    orderType: fulfillment.orderType,
    beType: fulfillment.beType,
    beCodePresent: Boolean(fulfillment.beCode),
  };

  if (!result.ok || !result.data) {
    console.log(
      JSON.stringify(
        { ok: false, code: productCode, storeCode, fulfillment: fulfillmentOut, ms, error: result.message || '详情查询失败' },
        null,
        2,
      ),
    );
    return 0; // 查不到不是崩溃：调用方按"没有详情"处理
  }

  const data = result.data;
  const composition = summarizeRounds(data.rounds);
  const modifyGroups = summarizeModification(data.modification);
  const canSwap = composition.some((round) => round.choices > 1);

  // P0-4：已知过敏原 → 对**未截断**的详情做菜名/选项名核对（composition/modifyGroups 已截断到 5 项，不能拿来扫）。
  // --allergens 覆盖本机 health.json（用于测试或临时指定）；拿不到就是 unknown，不是 none。
  const health = options.allergens
    ? {
        allergyKnown: 'known',
        allergens: String(options.allergens).split(/[,，、]/).map((item) => item.trim()).filter(Boolean),
      }
    : readHealth();
  if (health.allergyKnown === 'known' && health.allergens.length === 0) health.allergyKnown = 'unknown';
  const allergenCheck = scanAllergens(data, health);

  console.log(
    JSON.stringify(
      {
        ok: true,
        storeCode,
        candidateId: target?.candidateId || null,
        code: String(data.code || productCode),
        name: String(data.name || ''),
        image: safeImage(data.image),
        // 实测没有这个字段；将来有了就原样透传，没有就是 null（不自己拼链接）
        detailUrl: typeof data.detailUrl === 'string' && data.detailUrl ? data.detailUrl : null,
        fulfillment: fulfillmentOut,
        canSwap,
        canModify: Boolean(data.supportModify),
        allergenCheck,
        composition,
        modifyGroups,
        ms,
      },
      null,
      2,
    ),
  );
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    console.log(JSON.stringify({ ok: false, error: err.message }, null, 2));
    process.exitCode = 1;
  });
