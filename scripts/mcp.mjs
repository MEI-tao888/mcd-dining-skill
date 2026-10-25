#!/usr/bin/env node
/**
 * 麦当劳 MCP 客户端（简单麦 / Easy Eat · A1）
 *
 * 端点：https://mcp.mcd.cn （Streamable HTTP，JSON-RPC 2.0）
 * 认证：Token 只从环境变量 MCD_MCP_TOKEN 读取；不写文件、不打印、不进仓库。
 *
 * 只封装本项目用到的只读工具：
 *   - query-nearby-stores    到店门店（含营业状态/营业时间）
 *   - query-meals            门店菜单（分类 + 商品映射表）
 *   - calculate-price        权威算价（返回单位为「分」；外送另含配送费/打包费字段）
 *   - query-meal-detail      套餐组成（备用，A1 未使用）
 *   - query-store-coupons    门店可用券（只读；券码只在内存里，不打印、不落盘）
 *   - delivery-query-addresses  外送地址列表（**只读，返回值含个人信息，禁止落盘/打印**）
 *   - delivery-query-stores     外送门店（addressId + beType=2 → storeCode + beCode）
 *
 * 用法（在 meal-skill/ 下）：
 *   node scripts/mcp.mjs stores --city 武汉 --keyword 华中农业大学
 *   node scripts/mcp.mjs meals  --store 1960216
 *   node scripts/mcp.mjs price  --store 1960216 --items '[{"productCode":"9900005462","quantity":1}]'
 *   node scripts/mcp.mjs addresses                 # 只打印 addr#N，不打印联系人/电话/地址
 *   node scripts/mcp.mjs dstores --address-index 1 # 外送门店（不传 addressId）
 *   node scripts/mcp.mjs call   query-meal-detail --args '{"storeCode":"1960216","orderType":1,"beType":1,"code":"9900005462"}'
 *
 * 通用参数：--json（只打 JSON） --out <文件>（另存原始返回） --timeout <毫秒>
 */

import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_ENDPOINT = 'https://mcp.mcd.cn';
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * 含个人信息的只读工具：**禁止**用 `call` 子命令直接打印/落盘。
 * 只能走封装好的 addresses / dstores（只输出 addr#N、beCode 截断）。
 */
const SENSITIVE_TOOLS = new Set(['delivery-query-addresses', 'delivery-query-stores']);

// ---------------------------------------------------------------- 配置

export function resolveConfig(overrides = {}) {
  const endpoint = overrides.endpoint || process.env.MCD_MCP_URL || DEFAULT_ENDPOINT;
  const rawToken = overrides.token ?? process.env.MCD_MCP_TOKEN ?? '';
  const token = String(rawToken).trim();

  if (!token) {
    throw new Error(
      [
        '未设置 MCD_MCP_TOKEN，无法调用麦当劳 MCP。',
        'PowerShell：$env:MCD_MCP_TOKEN = "<你的 Token>"',
        'Token 申请：https://open.mcd.cn/mcp （手机号登录 → 控制台 → 激活 → 复制）',
        'Token 只放环境变量；不要写进仓库、日志或截图。',
      ].join('\n'),
    );
  }

  const timeoutMs = Number(overrides.timeoutMs || process.env.MCD_MCP_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  return { endpoint, token, timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS };
}

// ---------------------------------------------------------------- 传输层

function parseSse(text) {
  const messages = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    const dataLines = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart());
    if (!dataLines.length) continue;
    const data = dataLines.join('\n');
    if (data === '[DONE]') continue;
    try {
      messages.push(JSON.parse(data));
    } catch {
      /* 心跳/注释帧，忽略 */
    }
  }
  return messages;
}

/** 从 `{` 起做括号配平，切出第一段完整 JSON（工具返回常带前后说明文字）。 */
export function sliceBalancedJson(text, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** tools/call 的 content[] → 业务 JSON（麦当劳 MCP 用 text 承载 JSON）。 */
export function extractPayload(result) {
  const content = Array.isArray(result?.content) ? result.content : [];
  const text = content
    .filter((part) => part && part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n')
    .trim();

  if (!text) return { payload: null, text: '', note: '返回中没有 text 内容' };

  const marker = text.indexOf('{"success"');
  const start = marker >= 0 ? marker : text.indexOf('{');
  if (start < 0) return { payload: null, text, note: '返回中没有 JSON' };

  const json = sliceBalancedJson(text, start);
  if (!json) return { payload: null, text, note: 'JSON 括号未配平' };

  try {
    return { payload: JSON.parse(json), text, note: '' };
  } catch (err) {
    return { payload: null, text, note: `JSON 解析失败：${err.message}` };
  }
}

export class McpClient {
  #sessionId = null;
  #protocolVersion = '2025-06-18';
  #nextId = 1;
  #connected = false;

  constructor(config = {}) {
    this.config = resolveConfig(config);
  }

  async #rpc(method, params, { expectResult = true } = {}) {
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${this.config.token}`,
    };
    if (this.#sessionId) {
      headers['mcp-session-id'] = this.#sessionId;
      headers['mcp-protocol-version'] = this.#protocolVersion;
    }

    const id = this.#nextId++;
    const payload = { jsonrpc: '2.0', method };
    if (params !== undefined) payload.params = params;
    if (expectResult) payload.id = id;

    let res;
    try {
      res = await fetch(this.config.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (err) {
      const reason = err?.name === 'TimeoutError' ? `超时（${this.config.timeoutMs}ms）` : err.message;
      throw new Error(`网络请求失败：${reason}（端点 ${this.config.endpoint}）`);
    }

    const sid = res.headers.get('mcp-session-id');
    if (sid) this.#sessionId = sid;

    const contentType = res.headers.get('content-type') || '';
    const text = await res.text();

    if (!res.ok) {
      let hint = '';
      if (res.status === 401) hint = ' Token 无效或过期，请到 https://open.mcd.cn/mcp 重新申请。';
      else if (res.status === 429) hint = ' 触发限流（600 次/分钟），稍后重试。';
      throw new Error(`HTTP ${res.status} ${res.statusText}。${hint} 响应片段：${text.slice(0, 300)}`);
    }

    if (!expectResult) return null;

    if (contentType.includes('text/event-stream')) {
      const messages = parseSse(text);
      const msg = messages.find((m) => m && m.id === id) || messages[messages.length - 1];
      if (!msg) throw new Error('SSE 响应中没有可解析的 JSON-RPC 消息。');
      if (msg.error) throw new Error(`JSON-RPC ${msg.error.code}：${msg.error.message}`);
      return msg.result;
    }

    if (!text.trim()) return null;

    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      throw new Error(`响应不是合法 JSON：${text.slice(0, 300)}`);
    }
    if (msg.error) throw new Error(`JSON-RPC ${msg.error.code}：${msg.error.message}`);
    return msg.result;
  }

  async connect() {
    if (this.#connected) return;
    const init = await this.#rpc('initialize', {
      protocolVersion: this.#protocolVersion,
      capabilities: {},
      clientInfo: { name: 'easy-eat-mcd-client', version: '1.0.0' },
    });
    if (init?.protocolVersion) this.#protocolVersion = init.protocolVersion;
    await this.#rpc('notifications/initialized', undefined, { expectResult: false });
    this.#connected = true;
  }

  /**
   * 调用单个 Tool。返回 { ok, tool, args, data, message, code, traceId, ms, note }。
   * 不抛业务错误：调用失败也返回 ok=false，让上层如实记录。
   */
  async callTool(tool, args = {}) {
    const startedAt = Date.now();
    try {
      await this.connect();
      const result = await this.#rpc('tools/call', { name: tool, arguments: args });
      const { payload, text, note } = extractPayload(result);
      const businessOk = payload?.success !== false && (payload?.code === undefined || payload.code === 200);
      const ok = !result?.isError && !!payload && businessOk;
      return {
        ok,
        tool,
        args,
        data: payload?.data ?? null,
        message: payload?.message || (ok ? '请求成功' : note || '返回为空'),
        code: payload?.code ?? null,
        traceId: payload?.traceId ?? null,
        serverTime: payload?.datetime ?? null,
        ms: Date.now() - startedAt,
        note: ok ? '' : note || String(text || '').slice(0, 200),
      };
    } catch (err) {
      return {
        ok: false,
        tool,
        args,
        data: null,
        message: err.message,
        code: null,
        traceId: null,
        serverTime: null,
        ms: Date.now() - startedAt,
        note: '调用异常',
      };
    }
  }
}

// ---------------------------------------------------------------- 业务封装（只读）

const pickDefined = (obj) =>
  Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined && value !== null && value !== ''));

/** 到店门店：searchType=2 按位置搜（city+keyword），searchType=1 搜收藏。 */
export function queryNearbyStores(client, { city, keyword, searchType = 2, beType = 1 } = {}) {
  return client.callTool('query-nearby-stores', pickDefined({ city, keyword, searchType, beType }));
}

/** 门店菜单：到店自取固定 orderType=1 + beType=1，不传 beCode。 */
export function queryMeals(client, { storeCode, orderType = 1, beType = 1, beCode, reservationDate } = {}) {
  return client.callTool('query-meals', pickDefined({ storeCode, orderType, beType, beCode, reservationDate }));
}

/** 权威算价：返回字段单位是「分」。 */
export function calculatePrice(client, { storeCode, items, orderType = 1, beType = 1, beCode, reservationDate }) {
  return client.callTool(
    'calculate-price',
    pickDefined({ storeCode, orderType, beType, beCode, reservationDate, items }),
  );
}

export function queryMealDetail(client, { storeCode, code, orderType = 1, beType = 1, beCode, reservationDate }) {
  return client.callTool('query-meal-detail', pickDefined({ storeCode, code, orderType, beType, beCode, reservationDate }));
}

/**
 * 门店可用券（只读）：到店 orderType=1/beType=1 不传 beCode；外送 orderType=2/beType=2 传 beCode。
 * ⚠️ 返回里有 couponId / couponCode：**只用于当次 calculate-price，不打印、不落盘**。
 */
export function queryStoreCoupons(client, { storeCode, orderType = 1, beType = 1, beCode } = {}) {
  return client.callTool('query-store-coupons', pickDefined({ storeCode, orderType, beType, beCode }));
}

/**
 * 外送地址列表（只读）。
 * ⚠️ 返回含 contactName / phone / fullAddress / addressId：调用方**不得**写文件、写日志、打印。
 * 仓库里只允许保存 `addressRef`（如 addr#1）。
 */
export function deliveryQueryAddresses(client) {
  return client.callTool('delivery-query-addresses', {});
}

/** 外送门店：必须 addressId + beType=2；返回带 beCode（外送算价要传）。 */
export function deliveryQueryStores(client, { addressId, beType = 2 } = {}) {
  return client.callTool('delivery-query-stores', pickDefined({ addressId, beType }));
}

// ---------------------------------------------------------------- 菜单整形

/**
 * query-meals → 扁平商品列表（按菜单出现顺序，即门店自己的分类顺序）。
 * 同一 code 出现在多个分类时合并 categories/tags，位置取首次出现。
 */
export function flattenMenu(menusData) {
  const categories = Array.isArray(menusData?.categories) ? menusData.categories : [];
  const detailMap = menusData?.meals && typeof menusData.meals === 'object' ? menusData.meals : {};
  const byCode = new Map();

  categories.forEach((category, categoryIndex) => {
    const categoryName = String(category?.name || '').replace(/\s*\n\s*/g, ' ').trim();
    const meals = Array.isArray(category?.meals) ? category.meals : [];
    meals.forEach((entry, itemIndex) => {
      const code = String(entry?.code || '').trim();
      if (!code) return;
      const detail = detailMap[code] || {};
      let record = byCode.get(code);
      if (!record) {
        record = {
          productCode: code,
          name: String(detail.name || '').trim(),
          categories: [],
          tags: [],
          menuOrder: categoryIndex * 1000 + itemIndex,
        };
        byCode.set(code, record);
      }
      if (categoryName && !record.categories.includes(categoryName)) record.categories.push(categoryName);
      for (const tag of Array.isArray(entry?.tags) ? entry.tags : []) {
        const text = String(tag || '').trim();
        if (text && !record.tags.includes(text)) record.tags.push(text);
      }
      if (!record.name && detail.name) record.name = String(detail.name).trim();
    });
  });

  return [...byCode.values()]
    .filter((item) => item.name)
    .sort((a, b) => a.menuOrder - b.menuOrder);
}

// ---------------------------------------------------------------- CLI

function parseArgs(argv) {
  const [command = '', ...rest] = argv;
  const options = {};
  const positional = [];
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = rest[i + 1];
      if (next === undefined || next.startsWith('--')) {
        options[key] = true;
      } else {
        options[key] = next;
        i += 1;
      }
    } else {
      positional.push(token);
    }
  }
  return { command, options, positional };
}

function yuan(cents) {
  if (typeof cents !== 'number' || !Number.isFinite(cents)) return '—';
  return `¥${(cents / 100).toFixed(2)}`;
}

function printStores(result) {
  const stores = Array.isArray(result.data) ? result.data : [];
  if (!stores.length) {
    console.log(`\n[空] ${result.message}`);
    return;
  }
  console.log(`\n[门店] 共 ${stores.length} 家（已在营标记 ●）`);
  for (const store of stores) {
    const status = store.businessStatus ? '● 在营' : '○ 休息';
    const hours = `${store.businessStartTime || '?'}-${store.businessEndTime || '?'}`;
    console.log(
      `  ${status} ${store.storeCode}  ${store.storeName}  ${hours}  距离 ${store.distance ?? '?'}m` +
        (store.beCode ? `  beCode=${store.beCode}` : ''),
    );
  }
}

function printMeals(result) {
  const categories = result.data?.categories || [];
  const items = flattenMenu(result.data);
  console.log(`\n[菜单] 分类 ${categories.length} 个，商品 ${items.length} 个`);
  for (const category of categories) {
    const name = String(category?.name || '').replace(/\s*\n\s*/g, ' ');
    console.log(`  - ${name}：${(category?.meals || []).length} 项`);
  }
  console.log('\n  前 10 个商品（code / 名称 / 分类）：');
  for (const item of items.slice(0, 10)) {
    console.log(`    ${item.productCode}  ${item.name}  [${item.categories.join(' | ')}]`);
  }
}

function printPrice(result) {
  const data = result.data || {};
  console.log(`\n[算价] 合计 ${yuan(data.price)}（${data.price} 分）  原价 ${yuan(data.originalPrice)}  优惠 ${yuan(data.discount)}`);
  for (const product of data.productList || []) {
    console.log(`  - ${product.productName} ×${product.quantity}  小计 ${yuan(product.subtotal)}`);
  }
  // 外送才有的字段；有就打印，没有不猜。
  if (typeof data.deliveryPrice === 'number') {
    console.log(`  配送费 ${yuan(data.deliveryPrice)}（${data.deliveryPrice} 分，字段 deliveryPrice）`);
  }
  if (typeof data.packingPrice === 'number') {
    console.log(`  打包费 ${yuan(data.packingPrice)}（${data.packingPrice} 分，字段 packingPrice）`);
  }
  if (typeof data.productPrice === 'number') {
    console.log(`  商品合计 ${yuan(data.productPrice)}（${data.productPrice} 分，字段 productPrice）`);
  }
  const takeWay = (data.takeWayList || []).map((item) => `${item.title}/${item.code}`).join('，');
  if (takeWay) console.log(`  取餐方式：${takeWay}`);
}

/** 地址列表：只输出 addr#N，任何个人信息都不打印、不落盘。 */
function printAddresses(result) {
  const refs = result.data?.refs || [];
  if (!refs.length) {
    console.log(`\n[空] 没有可用外送地址（${result.message}）`);
    return;
  }
  console.log(`\n[地址] ${refs.length} 条（联系人/电话/完整地址/addressId 均不显示）`);
  for (const ref of refs) console.log(`  ${ref}`);
}

function printDeliveryStores(result) {
  const stores = Array.isArray(result.data) ? result.data : result.data?.stores || [];
  if (!stores.length) {
    console.log(`\n[空] 该地址没有可配送门店（${result.message}）`);
    return;
  }
  console.log(`\n[外送门店] 共 ${stores.length} 家（已在营标记 ●）`);
  for (const store of stores) {
    const status = store.businessStatus ? '● 在营' : '○ 休息';
    const hours = `${store.businessStartTime || '?'}-${store.businessEndTime || '?'}`;
    console.log(
      `  ${status} ${store.storeCode}  ${store.storeName}  ${hours}` +
        (store.beCode ? `  beCode=${String(store.beCode).slice(0, 2)}**（已截断）` : ''),
    );
  }
}

/** 门店券：只打标题/有效期/适用商品码；couponId 与 couponCode 一律不显示。 */
function printCoupons(result) {
  const list = Array.isArray(result.data) ? result.data : result.data?.coupons || [];
  if (!list.length) {
    console.log(`\n[空] 该门店当前没有可用券（${result.message}）`);
    return;
  }
  console.log(`\n[门店券] 共 ${list.length} 张（券码与券 ID 不显示）`);
  for (const coupon of list) {
    const products = (coupon.products || []).map((product) => `${product.productCode} ${product.productName}`).join('、');
    console.log(`  - ${coupon.title}  有效期 ${coupon.tradeDateTime || '?'}`);
    console.log(`    适用商品：${products || '—'}`);
  }
  console.log('  （真实券码只在 calculate-price 里当次使用，不打印、不落盘）');
}

async function main() {
  const { command, options, positional } = parseArgs(process.argv.slice(2));
  const outPath = options.out ? path.resolve(String(options.out)) : null;
  const wantJson = Boolean(options.json);
  const timeoutMs = options.timeout ? Number(options.timeout) : undefined;

  if (!['stores', 'meals', 'price', 'detail', 'coupons', 'addresses', 'dstores', 'call'].includes(command)) {
    console.error(
      [
        '用法：node scripts/mcp.mjs <命令> [参数]',
        '  stores    --city <城市> --keyword <关键词> [--search-type 2] [--be-type 1]',
        '  meals     --store <门店码> [--order-type 1|2] [--be-type 1|2] [--be-code <码>]',
        '  price     --store <门店码> --items \'[{"productCode":"...","quantity":1}]\' [--order-type 1|2] [--be-type 1|2] [--be-code <码>]',
        '  detail    --store <门店码> --code <商品码>',
        '  coupons   --store <门店码> [--order-type 1|2] [--be-type 1|2] [--be-code <码>]  # 券码不显示',
        '  addresses                                 # 只列 addr#N，不显示任何个人信息',
        '  dstores   [--address-index 1]             # 外送门店，用地址序号而不是 addressId',
        '  call      <toolName> --args \'{"...":"..."}\'  # 含个人信息的工具（delivery-*）一律拒绝',
        '通用：--json  --out <文件>  --timeout <毫秒>；addresses/dstores 的结果不落盘',
      ].join('\n'),
    );
    process.exitCode = 2;
    return;
  }

  const client = new McpClient({ timeoutMs });
  console.log(`端点：${client.config.endpoint}`);
  console.log(`命令：${command}`);

  let result;
  if (command === 'stores') {
    result = await queryNearbyStores(client, {
      city: options.city,
      keyword: options.keyword,
      searchType: options['search-type'] ? Number(options['search-type']) : 2,
      beType: options['be-type'] ? Number(options['be-type']) : 1,
    });
  } else if (command === 'meals') {
    result = await queryMeals(client, {
      storeCode: String(options.store || ''),
      orderType: options['order-type'] ? Number(options['order-type']) : 1,
      beType: options['be-type'] ? Number(options['be-type']) : 1,
      beCode: options['be-code'] ? String(options['be-code']) : undefined,
    });
  } else if (command === 'price') {
    let items;
    try {
      items = JSON.parse(String(options.items || '[]'));
    } catch {
      console.error('--items 不是合法 JSON。Windows 建议写成文件后用 --items "$(cat items.json)"，或改用 candidates.mjs。');
      process.exitCode = 2;
      return;
    }
    result = await calculatePrice(client, {
      storeCode: String(options.store || ''),
      items,
      orderType: options['order-type'] ? Number(options['order-type']) : 1,
      beType: options['be-type'] ? Number(options['be-type']) : 1,
      beCode: options['be-code'] ? String(options['be-code']) : undefined,
    });
  } else if (command === 'detail') {
    result = await queryMealDetail(client, { storeCode: String(options.store || ''), code: String(options.code || '') });
  } else if (command === 'coupons') {
    const raw = await queryStoreCoupons(client, {
      storeCode: String(options.store || ''),
      orderType: options['order-type'] ? Number(options['order-type']) : 1,
      beType: options['be-type'] ? Number(options['be-type']) : 1,
      beCode: options['be-code'] ? String(options['be-code']) : undefined,
    });
    // 券码/券 ID 只留在内存里：这里把 data 换成"可展示版"，--json 也不会漏。
    const list = Array.isArray(raw.data) ? raw.data : [];
    result = {
      ok: raw.ok,
      tool: raw.tool,
      message: raw.message,
      ms: raw.ms,
      traceId: raw.traceId,
      args: {
        storeCode: String(options.store || ''),
        orderType: options['order-type'] ? Number(options['order-type']) : 1,
        beType: options['be-type'] ? Number(options['be-type']) : 1,
        beCodePresent: Boolean(options['be-code']),
      },
      data: list.map((coupon) => ({
        title: coupon.title,
        tradeDateTime: coupon.tradeDateTime,
        promotionId: coupon.promotionId,
        products: coupon.products || [],
        couponCode: '[已隐藏]',
        couponId: '[已隐藏]',
      })),
    };
  } else if (command === 'addresses') {
    const raw = await deliveryQueryAddresses(client);
    const list = raw.data?.addresses || [];
    result = {
      ok: raw.ok,
      tool: raw.tool,
      message: raw.message,
      ms: raw.ms,
      traceId: raw.traceId,
      data: { count: list.length, refs: list.map((_, index) => `addr#${index + 1}`) },
      note: '联系人/电话/完整地址/addressId 已隐藏，不落盘',
    };
  } else if (command === 'dstores') {
    const index = Math.max(1, Number(options['address-index'] || 1));
    const addrRaw = await deliveryQueryAddresses(client);
    const list = addrRaw.data?.addresses || [];
    const picked = list[index - 1];
    if (!addrRaw.ok || !picked) {
      result = {
        ok: false,
        tool: 'delivery-query-stores',
        args: { addressRef: `addr#${index}`, beType: 2 },
        data: null,
        message: `没有第 ${index} 条外送地址（共 ${list.length} 条）`,
        ms: addrRaw.ms,
        traceId: addrRaw.traceId,
      };
    } else {
      const raw = await deliveryQueryStores(client, { addressId: picked.addressId, beType: 2 });
      result = { ...raw, args: { addressRef: `addr#${index}`, beType: 2 } };
    }
  } else {
    const toolName = positional[0];
    const normalizedTool = String(toolName || '').trim().toLowerCase();
    if (SENSITIVE_TOOLS.has(normalizedTool)) {
      // 拒绝在执行之前：不调工具、不打印结果、不写 --out。
      console.error(
        `拒绝执行：${normalizedTool} 该工具含个人信息，禁止用 call 打印/落盘；请用 addresses 命令（只输出 addr#N）`,
      );
      process.exitCode = 2;
      return;
    }
    let args = {};
    if (options.args) {
      try {
        args = JSON.parse(String(options.args));
      } catch {
        console.error('--args 不是合法 JSON。');
        process.exitCode = 2;
        return;
      }
    }
    result = await client.callTool(toolName, args);
  }

  // 外送地址类结果含个人信息，一律不落盘。
  const noPersist = command === 'addresses' || command === 'dstores' || command === 'coupons';
  if (outPath && noPersist) {
    console.log('（addresses/dstores 含个人信息，已跳过 --out 落盘）');
  } else if (outPath) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf8');
  }

  if (wantJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`状态：${result.ok ? 'OK' : '失败'}  ${result.ms}ms  traceId=${result.traceId || '—'}`);
    if (!result.ok) console.log(`原因：${result.message}`);
    if (result.ok && command === 'stores') printStores(result);
    if (result.ok && command === 'meals') printMeals(result);
    if (result.ok && command === 'price') printPrice(result);
    if (result.ok && command === 'addresses') printAddresses(result);
    if (result.ok && command === 'dstores') printDeliveryStores(result);
    if (result.ok && command === 'coupons') printCoupons(result);
    if (result.ok && (command === 'detail' || command === 'call')) {
      console.log(JSON.stringify(result.data, null, 2).slice(0, 2000));
    }
    if (outPath && !noPersist) console.log(`原始返回：${outPath}`);
  }

  if (!result.ok) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('mcp.mjs')) {
  main().catch((err) => {
    console.error(`\n[错误] ${err.message}\n`);
    process.exitCode = 1;
  });
}
