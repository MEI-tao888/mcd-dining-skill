#!/usr/bin/env node
/**
 * 候选生成（简单麦 / Easy Eat · A1.5）
 *
 * 这里**只有硬筛选**：履约方式（到店自取 / 外送）、门店营业、可售、偏好排除、预算。
 * 没有权重、没有评分、不排序——候选按固定类型顺序输出：稳妥 → 轻 → 奖励。
 * 在都合法的 2–3 组里挑"最合此刻"的那组，是 JEV 的活（A3）。
 *
 * 两种履约模式共用同一套候选逻辑，只替换「取数/算价」的适配层：
 *   pickup（默认）  query-nearby-stores(beType=1) → orderType=1 / beType=1 / 不传 beCode
 *   delivery        delivery-query-addresses → addressId → delivery-query-stores(beType=2)
 *                   → orderType=2 / beType=2 / 传 beCode
 *
 * 用法（在 meal-skill/ 下）：
 *   # 到店自取（默认）
 *   node scripts/candidates.mjs --city 武汉 --keyword 华中农业大学 --store 1960216 --people 1 --budget 80
 *   # 外送（不传 --address-id 时用账号里第 1 条地址；无地址则 NO_ADDRESS 回退到店自取）
 *   node scripts/candidates.mjs --mode delivery --city 武汉 --keyword 华中农业大学 --store 1960216 --people 1 --budget 80
 *   # 外送不传 --store：按「在营 → 关得更晚 → 更近」自动选一家可配送门店
 *   node scripts/candidates.mjs --mode delivery --city 武汉 --keyword 华中农业大学 --people 1 --budget 80
 *
 * 参数：
 *   --mode              pickup | delivery，默认 pickup
 *   --address-id        可选；不传则用地址列表第 1 条（**只用于调用，不落盘**）
 *   --city / --keyword  用于 query-nearby-stores 定位门店（回退到店自取时也需要）
 *   --store             门店编码；pickup 必填，delivery 可选（不传则按规则自动选一家）
 *   --people            人数，默认 1
 *   --budget            预算（元，含配送费/打包费）；不给则不启用预算剔除
 *   --avoid             偏好排除词（仅按菜单文字匹配，**不保证过敏安全**），如 "牛肉,辣"
 *   --coupons           auto：查门店券并给命中的那一项套券重算（默认关闭）
 *   --out               输出路径，默认 data/candidates.json
 *   --timeout           单次调用超时（毫秒），默认 30000
 *
 * 隐私：addressId / 联系人 / 电话 / 完整地址只存在于内存，不进 data JSON、不进日志、不进 stdout；
 *       仓库里只出现 addressRef（如 addr#1）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  McpClient,
  queryNearbyStores,
  queryMeals,
  calculatePrice,
  queryStoreCoupons,
  deliveryQueryAddresses,
  deliveryQueryStores,
  flattenMenu,
} from './mcp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(HERE, '..', 'data');

/** 两种履约模式：只有这里决定 orderType / beType。 */
const MODES = {
  pickup: { orderType: 1, beType: 1, label: '到店自取', needsAddress: false },
  delivery: { orderType: 2, beType: 2, label: '外送（麦乐送）', needsAddress: true },
};

// ---------------------------------------------------------------- 工具函数

const norm = (text) => String(text ?? '').replace(/\s+/g, '');

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

const yuan = (cents) =>
  typeof cents === 'number' && Number.isFinite(cents) ? `¥${(cents / 100).toFixed(2)}` : '—';

const toCents = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return null;
  return Math.round(num * 100);
};

function localStamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

/** 在菜单里按菜单顺序找第一个满足条件的商品（不是按价格、不是按分数）。 */
function findItem(menu, predicate, { excludeCodes = [] } = {}) {
  return menu.find((item) => !excludeCodes.includes(item.productCode) && predicate(item)) || null;
}

/** "07:00" → 420（分钟）；解析不了返回 null，不猜。 */
function parseClock(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? '').trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || hours > 24 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** 打烊时刻（分钟）：跨夜（如 07:00-01:00）按 +24h 计，才能比"谁关得更晚"。 */
function closeMinutes(store) {
  const start = parseClock(store?.businessStartTime);
  const end = parseClock(store?.businessEndTime);
  if (end === null) return null;
  return start !== null && end <= start ? end + 24 * 60 : end;
}

/**
 * 门店自动选择：只在 businessStatus=true（外送还要有 beCode）的门店里挑。
 * 规则顺序：打烊更晚 → 距离更近（接口不返回 distance 时此键失效）→ 门店返回顺序。
 * 注意：这不是候选餐品的"排序"，是选门店的固定规则。
 */
function pickOpenStore(stores, { requireBeCode = false } = {}) {
  const open = stores.filter((item) => item.businessStatus === true && (!requireBeCode || item.beCode));
  if (!open.length) return null;
  const ranked = [...open].sort((a, b) => {
    const closeA = closeMinutes(a) ?? -1;
    const closeB = closeMinutes(b) ?? -1;
    if (closeA !== closeB) return closeB - closeA;
    const distA = Number.isFinite(a.distance) ? a.distance : Number.POSITIVE_INFINITY;
    const distB = Number.isFinite(b.distance) ? b.distance : Number.POSITIVE_INFINITY;
    if (distA !== distB) return distA - distB;
    return 0; // 稳定排序：保持门店返回顺序
  });
  return ranked[0];
}

function pickDeliveryStore(stores) {
  return pickOpenStore(stores, { requireBeCode: true });
}

/** 门店选择的可审计记录（门店编码/营业时间都是公开信息）。 */
function storeSelectionView(stores, chosen, { autoSelected, policy }) {
  return {
    autoSelected,
    policy,
    distanceFieldAvailable: stores.some((item) => Number.isFinite(item.distance)),
    chosen: chosen ? String(chosen.storeCode) : null,
    considered: stores.map((item) => ({
      storeCode: String(item.storeCode),
      storeName: item.storeName,
      businessStatus: item.businessStatus === true,
      businessStartTime: item.businessStartTime ?? null,
      businessEndTime: item.businessEndTime ?? null,
      closeMinutes: closeMinutes(item),
      distance: Number.isFinite(item.distance) ? item.distance : null,
      beCodePresent: Boolean(item.beCode),
    })),
  };
}

/**
 * calculate-price 的返回 → 统一结构。
 * 只做「字段直取 + 一致性校验」，不做价格算术：展示的合计永远是 data.price。
 */
function priceView(data, requestedCodes) {
  const num = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
  const totalCents = num(data.price);
  const productCents = num(data.productPrice);
  const deliveryCents = num(data.deliveryPrice); // 仅外送
  const packingCents = num(data.packingPrice); // 仅外送
  const originalCents = num(data.originalPrice);
  const discountCents = num(data.discount);

  const parts = [productCents, deliveryCents, packingCents].filter((value) => value !== null);
  const componentSumCents = parts.reduce((sum, value) => sum + value, 0);
  const componentCheckOk = totalCents !== null && parts.length > 0 && componentSumCents === totalCents;
  const discountCheckOk =
    totalCents !== null && originalCents !== null && discountCents !== null && originalCents - discountCents === totalCents;

  const returned = Array.isArray(data.productList) ? data.productList : [];

  return {
    source: 'calculate-price',
    field: 'data.price',
    unit: '分',
    totalCents,
    totalYuan: yuan(totalCents),
    originalCents,
    originalYuan: yuan(originalCents),
    discountCents,
    discountYuan: yuan(discountCents),
    breakdown: {
      productCents,
      productYuan: yuan(productCents),
      deliveryCents,
      deliveryYuan: yuan(deliveryCents),
      packingCents,
      packingYuan: yuan(packingCents),
      note:
        'price = productPrice + deliveryPrice + packingPrice；originalPrice − discount = price；' +
        'productPrice 已是折后商品价（discount 已在其中），不再二次减 discount',
    },
    integrityOk: componentCheckOk && discountCheckOk,
    integrityDetail: { componentSumCents, componentCheckOk, discountCheckOk },
    productList: returned.map((product) => ({
      productCode: String(product.productCode),
      productName: product.productName,
      quantity: Number(product.quantity),
      subtotalCents: Number(product.subtotal),
      role: requestedCodes.includes(String(product.productCode)) ? 'product' : 'fee',
    })),
    takeWay: (data.takeWayList || []).map((item) => ({ code: item.code, title: item.title })),
  };
}

// ---------------------------------------------------------------- 三组类型（固定顺序）

/**
 * 每组类型给出「候选方案列表」：第一个是首选，算价失败时才试下一个（可售性兜底，不是比价）。
 * 组内改选只看"算价是否通过"，不看价格高低。
 */
const RECIPES = [
  {
    id: 'steady',
    type: '稳妥',
    typeNote: '熟悉的单人套餐，主食+小食+饮料一次给全，不用再想',
    build(menu, ctx) {
      const options = [];
      const singleSet = findItem(
        menu,
        (item) => item.categories.some((c) => /单人餐/.test(norm(c))),
        { excludeCodes: ctx.usedMain },
      );
      if (singleSet) {
        options.push({
          rule: '分类名含「单人餐」的第一个（按门店菜单顺序）',
          items: [{ productCode: singleSet.productCode, quantity: ctx.people }],
        });
      }
      const usedAfterSingle = [...ctx.usedMain, ...(singleSet ? [singleSet.productCode] : [])];
      const notSharing = (item) => !/双人|分享|多人|派对/.test(item.name);
      const threePiece = findItem(
        menu,
        (item) => item.tags.some((tag) => /三件套/.test(norm(tag))) && notSharing(item),
        { excludeCodes: usedAfterSingle },
      );
      if (threePiece) {
        options.push({
          rule: '标签含「三件套」的第一个（主食+小食+饮料的套餐）',
          items: [{ productCode: threePiece.productCode, quantity: ctx.people }],
        });
      }
      const fourPiece = findItem(
        menu,
        (item) => /四件套/.test(item.name) && notSharing(item),
        { excludeCodes: [...usedAfterSingle, ...(threePiece ? [threePiece.productCode] : [])] },
      );
      if (fourPiece) {
        options.push({
          rule: '名称含「四件套」的第一个（非双人/分享装）',
          items: [{ productCode: fourPiece.productCode, quantity: ctx.people }],
        });
      }
      const setTagged = findItem(
        menu,
        (item) =>
          item.tags.includes('套餐') &&
          !item.categories.some((c) => /小食|炸鸡|饮品|咖啡|甜品/.test(norm(c))),
        {
          excludeCodes: [
            ...usedAfterSingle,
            ...(threePiece ? [threePiece.productCode] : []),
            ...(fourPiece ? [fourPiece.productCode] : []),
          ],
        },
      );
      if (setTagged) {
        options.push({
          rule: '标签含「套餐」且不是小食/饮品（兜底）',
          items: [{ productCode: setTagged.productCode, quantity: ctx.people }],
        });
      }
      return options;
    },
  },
  {
    id: 'light',
    type: '轻',
    typeNote: '份量收一点，吃完不犯困',
    build(menu, ctx) {
      const options = [];
      const kcalSet = findItem(
        menu,
        (item) => item.categories.some((c) => /500大卡/.test(norm(c))),
        { excludeCodes: ctx.usedMain },
      );
      if (kcalSet) {
        options.push({
          rule: '分类名含「500大卡」的第一个',
          items: [{ productCode: kcalSet.productCode, quantity: ctx.people }],
        });
      }
      const singleBurger = findItem(menu, (item) => item.tags.includes('单品') && /堡|卷/.test(item.name), {
        excludeCodes: ctx.usedMain,
      });
      const veg = findItem(menu, (item) => /玉米杯|沙拉/.test(item.name), { excludeCodes: ctx.usedMain });
      if (singleBurger && veg) {
        options.push({
          rule: '单品堡 + 玉米杯/沙拉（兜底组合）',
          items: [
            { productCode: singleBurger.productCode, quantity: ctx.people },
            { productCode: veg.productCode, quantity: ctx.people },
          ],
        });
      }
      return options;
    },
  },
  {
    id: 'reward',
    type: '奖励',
    typeNote: '今天对自己好一点，主堡升级加个可分享的小食',
    build(menu, ctx) {
      const options = [];
      const main = findItem(
        menu,
        (item) =>
          item.categories.some((c) => /安格斯|厚牛/.test(norm(c))) &&
          /堡/.test(item.name) &&
          !/套餐|件套|随心选|组合/.test(item.name),
        { excludeCodes: ctx.usedMain },
      );
      if (!main) return options;
      const side = findItem(
        menu,
        (item) => item.categories.some((c) => /小食拼盘|炸鸡/.test(norm(c))) && !/堡|卷/.test(item.name),
        { excludeCodes: [...ctx.usedMain, main.productCode] },
      );
      if (!side) return options;
      const drink = findItem(menu, (item) => item.categories.some((c) => /饮品|麦咖啡/.test(norm(c))), {
        excludeCodes: [...ctx.usedMain, main.productCode, side.productCode],
      });
      if (drink) {
        options.push({
          rule: '厚牛堡 + 可分享小食 + 饮品',
          items: [
            { productCode: main.productCode, quantity: ctx.people },
            { productCode: side.productCode, quantity: 1 },
            { productCode: drink.productCode, quantity: ctx.people },
          ],
        });
      }
      options.push({
        rule: '厚牛堡 + 可分享小食（无合适饮品时的兜底；仅算价失败才换）',
        items: [
          { productCode: main.productCode, quantity: ctx.people },
          { productCode: side.productCode, quantity: 1 },
        ],
      });
      return options;
    },
  },
];

// ---------------------------------------------------------------- 履约解析

/** 到店自取：按城市/关键词找门店，再按 storeCode 命中。 */
async function resolvePickup(client, { city, keyword, storeCode, recordCall, allowAutoSelect = false }) {
  const res = recordCall(await queryNearbyStores(client, { city, keyword, searchType: 2, beType: 1 }));
  if (!res.ok) {
    return { error: { code: 'STORE_LOOKUP_FAILED', message: res.message, detail: 'query-nearby-stores 调用失败' } };
  }
  const stores = Array.isArray(res.data) ? res.data : [];
  let store = null;
  let autoSelected = false;
  if (storeCode) {
    store = stores.find((item) => String(item.storeCode) === storeCode) || null;
  } else if (allowAutoSelect) {
    // 只在"外送回退到店自取"时用：与选外送门店同一套规则（在营 → 打烊更晚 → 更近）。
    store = pickOpenStore(stores);
    autoSelected = Boolean(store);
  }
  if (!store) {
    return {
      error: {
        code: storeCode ? 'STORE_NOT_ON_LIST' : 'NO_PICKUP_STORE',
        message: storeCode ? '门店未出现在到店门店列表里' : '到店列表里没有正在营业的门店',
        detail: `返回的门店：${stores.map((item) => item.storeCode).join('、') || '（空）'}`,
      },
    };
  }
  return {
    store,
    beCode: null,
    addressRef: null,
    selection: storeSelectionView(stores, store, {
      autoSelected,
      policy: autoSelected
        ? '回退到店自取：在营（businessStatus=true）→ 打烊更晚 → 距离更近 → 门店返回顺序'
        : '调用方指定 storeCode',
    }),
  };
}

/**
 * 外送：地址 → 外送门店 → storeCode + beCode。
 * 不传 storeCode 时按「在营 → 打烊更晚 → 更近」自动选一家。
 * 失败一律返回结构化错误码，由调用方回退到店自取；不编造地址或门店。
 */
async function resolveDelivery(client, { storeCode, addressId, recordCall, secrets, onAddressRef }) {
  const addrRes = recordCall(await deliveryQueryAddresses(client));
  if (!addrRes.ok) {
    return {
      error: { code: 'DELIVERY_LOOKUP_FAILED', message: addrRes.message, detail: 'delivery-query-addresses 调用失败' },
    };
  }

  const addresses = Array.isArray(addrRes.data?.addresses) ? addrRes.data.addresses : [];
  if (!addresses.length) {
    return { error: { code: 'NO_ADDRESS', message: '账号下没有可用的外送地址', detail: 'addresses 为空' } };
  }

  let index = 0;
  if (addressId) {
    index = addresses.findIndex((item) => String(item.addressId) === String(addressId));
    if (index < 0) {
      return {
        error: {
          code: 'NO_ADDRESS',
          message: '指定的地址不在该账号的外送地址列表中',
          detail: '传入的 addressId 未命中任何地址（值不回显）',
        },
      };
    }
  }

  const picked = addresses[index];
  const addressRef = `addr#${index + 1}`;
  // addressId 只进内存，后面所有输出都用 addressRef 代替。
  if (typeof onAddressRef === 'function') onAddressRef(addressRef);
  if (picked.addressId) secrets.add(String(picked.addressId));
  for (const item of addresses) {
    if (item.addressId) secrets.add(String(item.addressId));
    if (item.phone) secrets.add(String(item.phone));
    if (item.contactName) secrets.add(String(item.contactName));
    if (item.fullAddress) secrets.add(String(item.fullAddress));
  }

  const storesRes = recordCall(await deliveryQueryStores(client, { addressId: picked.addressId, beType: 2 }));
  if (!storesRes.ok) {
    return {
      error: {
        code: 'DELIVERY_LOOKUP_FAILED',
        message: storesRes.message,
        detail: 'delivery-query-stores 调用失败',
      },
    };
  }

  const stores = Array.isArray(storesRes.data) ? storesRes.data : storesRes.data?.stores || [];
  if (!stores.length) {
    return {
      error: { code: 'NO_DELIVERY_STORE', message: '该地址没有可配送的外送门店', detail: `${addressRef} 返回门店为空` },
    };
  }

  let store = null;
  let selection = null;

  if (storeCode) {
    store = stores.find((item) => String(item.storeCode) === storeCode) || null;
    if (!store) {
      return {
        error: {
          code: 'NO_DELIVERY_STORE',
          message: '该门店不在这个地址的配送范围',
          detail: `可配送门店：${stores.map((item) => item.storeCode).join('、')}`,
        },
      };
    }
    selection = storeSelectionView(stores, store, {
      autoSelected: false,
      policy: '调用方指定 storeCode',
    });
  } else {
    store = pickDeliveryStore(stores);
    if (!store) {
      return {
        error: {
          code: 'NO_DELIVERY_STORE',
          message: '该地址有可配送门店，但此刻都不在营业',
          detail: stores
            .map(
              (item) =>
                `${item.storeCode} ${item.businessStartTime}-${item.businessEndTime} ${
                  item.businessStatus ? '在营' : '休息'
                }`,
            )
            .join('、'),
        },
        selection: storeSelectionView(stores, null, {
          autoSelected: true,
          policy: '在营 → 打烊更晚 → 更近',
        }),
      };
    }
    selection = storeSelectionView(stores, store, {
      autoSelected: true,
      policy: '在营（businessStatus=true 且有 beCode）→ 打烊更晚 → 距离更近（该工具不返回 distance 时此键失效）→ 门店返回顺序',
    });
  }

  if (!store.beCode) {
    return {
      error: {
        code: 'NO_DELIVERY_STORE',
        message: '外送门店没有 beCode，无法算价',
        detail: `门店 ${store.storeCode} 返回缺 beCode`,
      },
      selection,
    };
  }

  return { store, beCode: String(store.beCode), addressRef, selection };
}

/**
 * 解析本次履约：pickup 直接用；delivery 失败则**自然回退**到 pickup，并记录原因。
 */
async function resolveFulfillment(client, { mode, city, keyword, storeCode, addressId, recordCall, secrets, onAddressRef }) {
  const base = {
    requestedMode: mode,
    addressIdProvided: Boolean(addressId),
    fallback: null,
  };

  if (mode === 'delivery') {
    const delivery = await resolveDelivery(client, { storeCode, addressId, recordCall, secrets, onAddressRef });
    if (!delivery.error) {
      return {
        ...base,
        effectiveMode: 'delivery',
        orderType: MODES.delivery.orderType,
        beType: MODES.delivery.beType,
        beCode: delivery.beCode,
        label: MODES.delivery.label,
        store: delivery.store,
        addressRef: delivery.addressRef,
        selection: delivery.selection,
      };
    }

    // 回退：没传 --store 时，用「门店返回顺序里第一家还开着的」，不编造门店。
    const pickup = await resolvePickup(client, { city, keyword, storeCode, recordCall, allowAutoSelect: true });
    if (pickup.error) {
      return { ...base, fatal: pickup.error, deliveryError: delivery.error };
    }
    return {
      ...base,
      effectiveMode: 'pickup',
      orderType: MODES.pickup.orderType,
      beType: MODES.pickup.beType,
      beCode: null,
      label: MODES.pickup.label,
      store: pickup.store,
      addressRef: delivery.error.code === 'NO_ADDRESS' ? null : delivery.addressRef || null,
      selection: pickup.selection,
      deliverySelection: delivery.selection || null,
      fallback: { ...delivery.error, note: '外送不可用，已自然回退到店自取；未编造任何地址或门店' },
    };
  }

  const pickup = await resolvePickup(client, { city, keyword, storeCode, recordCall });
  if (pickup.error) return { ...base, fatal: pickup.error };
  return {
    ...base,
    effectiveMode: 'pickup',
    orderType: MODES.pickup.orderType,
    beType: MODES.pickup.beType,
    beCode: null,
    label: MODES.pickup.label,
    store: pickup.store,
    addressRef: null,
    selection: pickup.selection,
  };
}

// ---------------------------------------------------------------- 主流程

async function main() {
  const startedAt = new Date();
  const options = parseArgs(process.argv.slice(2));
  const mode = String(options.mode || 'pickup').toLowerCase();
  if (!MODES[mode]) {
    console.error(`--mode 只能是 pickup 或 delivery，收到：${mode}`);
    process.exitCode = 2;
    return;
  }

  const city = options.city ? String(options.city) : '';
  const keyword = options.keyword ? String(options.keyword) : '';
  const storeCode = options.store ? String(options.store) : '';
  const addressId = options['address-id'] ? String(options['address-id']) : '';
  const people = Math.max(1, Number(options.people || 1) || 1);
  const budgetCents = toCents(options.budget);
  const avoidTerms = options.avoid
    ? String(options.avoid)
        .split(/[,，]/)
        .map((term) => term.trim())
        .filter(Boolean)
    : [];
  const outPath = options.out ? path.resolve(String(options.out)) : path.join(DATA_DIR, 'candidates.json');
  const timeoutMs = options.timeout ? Number(options.timeout) : undefined;

  // 券：默认关闭；只有 --coupons auto 才会去查门店券。
  const couponsMode = options.coupons === undefined ? 'off' : String(options.coupons).toLowerCase();
  if (!['off', 'auto'].includes(couponsMode)) {
    console.error(`--coupons 只能是 auto（或省略），收到：${options.coupons}`);
    process.exitCode = 2;
    return;
  }

  if (!city || !keyword) {
    console.error('缺少参数：--city、--keyword 必填（门店要用门店工具定位，才能拿到营业状态）。');
    process.exitCode = 2;
    return;
  }
  if (mode === 'pickup' && !storeCode) {
    console.error('pickup 模式必须传 --store（到店自取不会替用户换店；外送才支持自动选店）。');
    process.exitCode = 2;
    return;
  }

  const client = new McpClient({ timeoutMs });
  const secrets = new Set();
  // 地址的唯一对外表示：addr#N。addressId 只在这一个进程的内存里。
  let activeAddressRef = null;

  const scrub = (text) => {
    let out = String(text ?? '');
    for (const secret of secrets) {
      if (secret && secret.length > 2) out = out.split(secret).join('[已隐藏]');
    }
    return out;
  };

  /** 落盘统一入口：脱敏 + 末尾换行（UTF-8，文件末尾保留换行）。 */
  const writeReport = (target, payload) => {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${scrub(JSON.stringify(payload, null, 2))}\n`, 'utf8');
  };

  const report = {
    schema: 'easy-eat/candidates@2',
    generatedAt: startedAt.toISOString(),
    generatedAtLocal: localStamp(startedAt),
    store: null,
    request: {
      mode,
      city,
      keyword,
      storeCode: storeCode || null,
      storeProvided: Boolean(storeCode),
      people,
      budgetCents,
      budgetYuan: budgetCents === null ? null : (budgetCents / 100).toFixed(2),
      avoidTerms,
      avoidPolicy: 'preference-exclusion-only',
      addressIdProvided: Boolean(addressId),
    },
    fulfillment: null,
    filters: [],
    menu: null,
    candidates: [],
    avoided: [],
    rejected: [],
    failures: [],
    calls: [],
    notes: [
      '价格只来自 calculate-price 的 data.price，单位「分」；脚本不做价格算术，只做格式换算与一致性校验。',
      '外送的配送费/打包费取返回字段 deliveryPrice / packingPrice，不手算；预算按含费用的 data.price 判断。',
      '候选按固定类型顺序输出（稳妥 → 轻 → 奖励），不是按得分或价格排序。',
      '组内换下一个方案只发生在「算价失败（不可售）」时，不发生在「更便宜」时。',
      '--avoid 只是偏好排除：仅按菜单文字匹配，不构成过敏安全保证。',
      '券只服务于已经选中的那一份：不为用券改类型、不加券专属商品、不组合多张券；券码不落盘。',
      '隐私：addressId / 联系人 / 电话 / 完整地址不写本文件；地址只以 addressRef 出现。',
    ],
  };

  const recordCall = (result) => {
    const args = { ...result.args };
    if ('addressId' in args) {
      // 不留 addressId 键，只留 addressRef。
      delete args.addressId;
      if (activeAddressRef) args.addressRef = activeAddressRef;
    }
    if (Array.isArray(args.items)) {
      // 只记商品码×数量；券 ID/券码不写进日志（最多标一个"券"字）。
      args.items = args.items
        .map((item) => `${item.productCode}×${item.quantity}${item.couponId ? '·券' : ''}`)
        .join(',');
    }
    report.calls.push({
      tool: result.tool,
      args,
      ok: result.ok,
      ms: result.ms,
      traceId: result.traceId,
      message: scrub(result.message),
      serverTime: result.serverTime,
    });
    if (!result.ok) {
      report.failures.push({ tool: result.tool, args, message: scrub(result.message), ms: result.ms });
    }
    return result;
  };

  console.log(`端点：${client.config.endpoint}`);
  console.log(`模式：${MODES[mode].label}${addressId ? '（指定地址：按传入值匹配，不回显）' : ''}`);

  // 1) 履约解析：外送失败会自动回退到店自取
  const fulfillment = await resolveFulfillment(client, {
    mode,
    city,
    keyword,
    storeCode,
    addressId,
    recordCall,
    secrets,
    onAddressRef: (ref) => {
      activeAddressRef = ref;
    },
  });

  if (fulfillment.fatal) {
    report.fulfillment = {
      requestedMode: mode,
      effectiveMode: null,
      error: fulfillment.fatal,
      deliveryError: fulfillment.deliveryError || null,
    };
    report.rejected.push({
      type: '履约',
      reason: fulfillment.fatal.code,
      detail: scrub(fulfillment.fatal.detail || fulfillment.fatal.message),
    });
    writeReport(outPath, report);
    console.error(`\n[失败] ${fulfillment.fatal.code}：${fulfillment.fatal.message}`);
    process.exitCode = 1;
    return;
  }

  const store = fulfillment.store;
  // 实际使用的门店：可能是 --store 指定的，也可能是外送自动选出来的。
  const activeStoreCode = String(store.storeCode);
  report.fulfillment = {
    requestedMode: fulfillment.requestedMode,
    effectiveMode: fulfillment.effectiveMode,
    label: fulfillment.label,
    orderType: fulfillment.orderType,
    beType: fulfillment.beType,
    beCodePresent: Boolean(fulfillment.beCode),
    addressRef: fulfillment.addressRef,
    addressIdProvided: fulfillment.addressIdProvided,
    storeSelection: fulfillment.selection || null,
    deliveryStoreSelection: fulfillment.deliverySelection || null,
    fallback: fulfillment.fallback
      ? { code: fulfillment.fallback.code, message: fulfillment.fallback.message, detail: scrub(fulfillment.fallback.detail || ''), note: fulfillment.fallback.note }
      : null,
  };

  report.store = {
    storeCode: String(store.storeCode),
    storeName: store.storeName,
    businessStatus: store.businessStatus === true,
    businessStartTime: store.businessStartTime,
    businessEndTime: store.businessEndTime,
    distance: store.distance ?? null,
    beCodePresent: Boolean(store.beCode),
    autoSelected: Boolean(fulfillment.selection?.autoSelected),
  };

  if (fulfillment.fallback) {
    console.log(`\n[回退] ${fulfillment.fallback.code}：${fulfillment.fallback.message}`);
    console.log(`       已自然回退到「${fulfillment.label}」，未编造地址或门店。`);
  }
  if (fulfillment.selection?.autoSelected) {
    const optionText = (fulfillment.selection.considered || [])
      .map(
        (item) =>
          `${item.storeCode}(${item.businessStartTime}-${item.businessEndTime} ${item.businessStatus ? '在营' : '休息'})`,
      )
      .join('、');
    console.log(`\n[选店] 未指定 --store，按规则自动选择：${fulfillment.selection.policy}`);
    console.log(`       候选门店：${optionText}`);
    console.log(
      `       选中：${report.store.storeCode}（打烊 ${report.store.businessEndTime}${
        fulfillment.selection.distanceFieldAvailable ? `，距离 ${report.store.distance}m` : '；该接口未返回 distance，距离键未参与'
      }）`,
    );
  }
  console.log(
    `门店：${report.store.storeName}（${report.store.storeCode}）  营业 ${report.store.businessStartTime}-${report.store.businessEndTime}` +
      (report.store.distance ? `  ${report.store.distance}m` : ''),
  );

  report.filters.push({
    id: 'fulfillment',
    label: '履约方式',
    applied: true,
    detail:
      `${fulfillment.label}：orderType=${fulfillment.orderType}、beType=${fulfillment.beType}` +
      (fulfillment.beCode ? '、传 beCode' : '、不传 beCode') +
      (fulfillment.addressRef ? `；地址 ${fulfillment.addressRef}（不含 addressId/联系人/电话/地址）` : '') +
      (fulfillment.fallback ? `；外送已回退：${fulfillment.fallback.code}` : ''),
  });

  // 2) 门店营业：不在营直接停止（不猜"应该还开着"）
  if (!report.store.businessStatus) {
    report.filters.push({
      id: 'store-open',
      label: '门店营业',
      applied: true,
      detail: `businessStatus=false，营业时间 ${store.businessStartTime}-${store.businessEndTime}，此刻不可点`,
    });
    writeReport(outPath, report);
    console.log(`\n[停止] ${report.store.storeName} 此刻不在营业时间（${store.businessStartTime}-${store.businessEndTime}）。`);
    process.exitCode = 1;
    return;
  }
  report.filters.push({
    id: 'store-open',
    label: '门店营业',
    applied: true,
    detail: `businessStatus=true，营业时间 ${store.businessStartTime}-${store.businessEndTime}`,
  });

  // 3) 菜单（按当前履约方式取，外送菜单可能与到店不同）
  const mealsResult = recordCall(
    await queryMeals(client, {
      storeCode: activeStoreCode,
      orderType: fulfillment.orderType,
      beType: fulfillment.beType,
      beCode: fulfillment.beCode || undefined,
    }),
  );
  if (!mealsResult.ok || !mealsResult.data) {
    console.error(`\n[失败] 菜单查询失败：${mealsResult.message}`);
    writeReport(outPath, report);
    process.exitCode = 1;
    return;
  }

  const fullMenu = flattenMenu(mealsResult.data);
  const categoryNames = (mealsResult.data.categories || []).map((category) =>
    String(category.name || '').replace(/\s*\n\s*/g, ' ').trim(),
  );
  report.menu = {
    storeCode: activeStoreCode,
    mode: fulfillment.effectiveMode,
    orderType: fulfillment.orderType,
    beType: fulfillment.beType,
    categories: categoryNames,
    itemCount: fullMenu.length,
    traceId: mealsResult.traceId,
  };

  if (!fullMenu.length) {
    console.error('\n[失败] 菜单为空，无法生成候选。');
    writeReport(outPath, report);
    process.exitCode = 1;
    return;
  }

  // 4) 偏好排除（**不是过敏安全**）：按名称/标签/分类做关键词剔除
  const menu = fullMenu.filter((item) => {
    const haystack = [item.name, ...item.tags, ...item.categories].join(' ');
    const hit = avoidTerms.find((term) => haystack.includes(term));
    if (!hit) return true;
    const entry = {
      productCode: item.productCode,
      name: item.name,
      term: hit,
      reason: `因偏好排除词「${hit}」被剔除`,
    };
    report.avoided.push(entry);
    report.rejected.push({
      type: '商品',
      reason: entry.reason,
      detail: `${item.name}（${item.productCode}）；仅按菜单文字匹配，不保证过敏安全`,
    });
    return false;
  });

  report.filters.push({
    id: 'avoid',
    label: '偏好排除',
    applied: avoidTerms.length > 0,
    detail: avoidTerms.length
      ? `剔除词：${avoidTerms.join('、')}；命中 ${report.avoided.length} 个商品。**仅按菜单文字匹配，不保证过敏安全**（配料表/交叉接触无法覆盖，过敏请以门店与包装标注为准）`
      : '本次未提供偏好排除词，未剔除任何商品（过敏安全仍需人工确认，本脚本不提供过敏保证）',
  });

  // 5) 逐组生成候选：硬筛 + 权威算价
  const ctx = { people, usedMain: [] };

  for (const recipe of RECIPES) {
    const options = recipe.build(menu, ctx);
    if (!options.length) {
      report.rejected.push({
        type: recipe.type,
        reason: '菜单里没有匹配的可用商品',
        detail:
          `规则未命中：${recipe.typeNote}` +
          (avoidTerms.length ? `；偏好排除词「${avoidTerms.join('、')}」可能已把该组剔除` : ''),
      });
      continue;
    }

    let placed = false;
    // 组内换下一个方案只允许发生在「算价失败 / 不可售」；因超预算而换更便宜的方案＝比价，禁止。
    // 预算检查挪到券应用之后（券可能把某组从超预算变成预算内）。

    for (const option of options) {
      const items = option.items.filter(Boolean);
      const missing = items.filter((item) => !menu.some((entry) => entry.productCode === item.productCode));
      if (missing.length) {
        report.rejected.push({
          type: recipe.type,
          reason: '商品不在门店菜单（不可售）',
          detail: `缺失：${missing.map((item) => item.productCode).join('、')}`,
        });
        continue;
      }

      const priceResult = recordCall(
        await calculatePrice(client, {
          storeCode: activeStoreCode,
          items,
          orderType: fulfillment.orderType,
          beType: fulfillment.beType,
          beCode: fulfillment.beCode || undefined,
        }),
      );

      if (!priceResult.ok || !priceResult.data) {
        report.rejected.push({
          type: recipe.type,
          rule: option.rule,
          reason: '算价失败，按不可售处理',
          detail: priceResult.message,
        });
        continue;
      }

      const requestedCodes = items.map((item) => item.productCode);
      const view = priceView(priceResult.data, requestedCodes);
      const returned = Array.isArray(priceResult.data.productList) ? priceResult.data.productList : [];

      // 券专属 SKU：不带券时 price=0 且 productList 为空，只能靠券购买 → 不当普通候选。
      if (view.totalCents === 0 && returned.length === 0) {
        report.rejected.push({
          type: recipe.type,
          rule: option.rule,
          reason: '券专属商品（无券不可售）',
          detail: 'calculate-price 返回 price=0 且 productList 为空；这类商品只能靠券购买，不进入普通候选',
        });
        continue;
      }

      const allReturned = items.every((requested) => {
        const hit = returned.find((product) => String(product.productCode) === requested.productCode);
        return hit && Number(hit.quantity) === requested.quantity;
      });
      if (!allReturned) {
        report.rejected.push({
          type: recipe.type,
          rule: option.rule,
          reason: '算价返回的商品与请求不一致（不可售）',
          detail: `请求 ${items.map((item) => `${item.productCode}×${item.quantity}`).join(', ')}；返回 ${returned
            .map((item) => `${item.productCode}×${item.quantity}`)
            .join(', ')}`,
        });
        continue;
      }

      const totalCents = view.totalCents;

      const itemsOut = items.map((requested) => {
        const entry = menu.find((item) => item.productCode === requested.productCode);
        const priced = returned.find((product) => String(product.productCode) === requested.productCode);
        return {
          productCode: requested.productCode,
          name: entry?.name || priced?.productName || '',
          quantity: requested.quantity,
          categories: entry?.categories || [],
          tags: entry?.tags || [],
          subtotalCents: Number(priced?.subtotal ?? 0),
          subtotalYuan: yuan(Number(priced?.subtotal ?? 0)),
        };
      });

      report.candidates.push({
        id: `${recipe.id}-${report.candidates.length + 1}`,
        type: recipe.type,
        typeNote: recipe.typeNote,
        rule: option.rule,
        items: itemsOut,
        price: { ...view, traceId: priceResult.traceId, ms: priceResult.ms },
        budget:
          budgetCents === null
            ? { applied: false, detail: '未提供预算，不做预算剔除' }
            : {
                applied: true,
                budgetCents,
                ok: totalCents !== null && totalCents <= budgetCents,
                remainingCents: totalCents !== null ? budgetCents - totalCents : null,
                basis:
                  fulfillment.effectiveMode === 'delivery'
                    ? '含配送费/打包费的 data.price'
                    : 'data.price（到店自取无配送费/打包费字段）',
              },
      });

      ctx.usedMain.push(items[0].productCode);
      placed = true;
      break;
    }

    if (!placed) {
      report.rejected.push({
        type: recipe.type,
        reason: '本组没有能通过硬筛的具体方案',
        detail: '见上方同类型记录',
      });
    }
  }

  // 5.5) 券：只让"已经选中的这一份"更值 —— 不换类型、不加商品、不组合多张券
  const couponReport = { mode: couponsMode, scanned: 0, matched: 0, applied: 0, error: null };

  if (couponsMode === 'auto') {
    const couponsRes = recordCall(
      await queryStoreCoupons(client, {
        storeCode: activeStoreCode,
        orderType: fulfillment.orderType,
        beType: fulfillment.beType,
        beCode: fulfillment.beCode || undefined,
      }),
    );

    if (!couponsRes.ok) {
      couponReport.error = scrub(couponsRes.message);
    } else {
      const list = Array.isArray(couponsRes.data) ? couponsRes.data : [];
      couponReport.scanned = list.length;

      // productCode → 券；同一商品只留第一张（不组合多张券）
      const couponByProduct = new Map();
      for (const coupon of list) {
        if (!coupon?.couponId || !coupon?.couponCode) continue;
        for (const product of coupon.products || []) {
          const code = String(product.productCode || '');
          if (code && !couponByProduct.has(code)) {
            couponByProduct.set(code, {
              couponId: String(coupon.couponId),
              couponCode: String(coupon.couponCode),
              title: String(coupon.title || '门店券'),
            });
          }
        }
      }

      for (const candidate of report.candidates) {
        const index = candidate.items.findIndex((item) => couponByProduct.has(item.productCode));
        if (index < 0) {
          candidate.coupon = { applied: false };
          continue;
        }

        couponReport.matched += 1;
        const coupon = couponByProduct.get(candidate.items[index].productCode);
        const pricedItems = candidate.items.map((item, i) =>
          i === index
            ? {
                productCode: item.productCode,
                quantity: item.quantity,
                couponId: coupon.couponId,
                couponCode: coupon.couponCode,
              }
            : { productCode: item.productCode, quantity: item.quantity },
        );

        const reprice = recordCall(
          await calculatePrice(client, {
            storeCode: activeStoreCode,
            items: pricedItems,
            orderType: fulfillment.orderType,
            beType: fulfillment.beType,
            beCode: fulfillment.beCode || undefined,
          }),
        );

        if (!reprice.ok || !reprice.data) {
          candidate.coupon = { applied: false, note: '用券算价失败，保留原价' };
          continue;
        }

        const returned = Array.isArray(reprice.data.productList) ? reprice.data.productList : [];
        const view = priceView(reprice.data, candidate.items.map((item) => item.productCode));
        const allReturned = candidate.items.every((requested) => {
          const hit = returned.find((product) => String(product.productCode) === requested.productCode);
          return hit && Number(hit.quantity) === requested.quantity;
        });
        if (!view.totalCents || !returned.length || !allReturned) {
          candidate.coupon = { applied: false, note: '券后不可售，保留原价' };
          continue;
        }

        const before = candidate.price;
        candidate.price = { ...view, traceId: reprice.traceId, ms: reprice.ms };
        candidate.coupon = {
          applied: true,
          title: coupon.title,
          priceBeforeCouponCents: before.totalCents,
          priceAfterCouponCents: view.totalCents,
          savingsCents: Math.max(0, (view.discountCents || 0) - (before.discountCents || 0)),
          discountCents: view.discountCents,
          basis: 'savings = 券后 discount − 券前 discount（两者都是 calculate-price 返回字段，未手算）',
        };
        couponReport.applied += 1;
      }
    }
  } else {
    for (const candidate of report.candidates) candidate.coupon = { applied: false };
  }

  // 5.6) 预算：按最终（券后）data.price 判断；券把某组拉回预算内就保留该组，类型不变
  if (budgetCents !== null) {
    const kept = [];
    for (const candidate of report.candidates) {
      const total = candidate.price.totalCents;
      const ok = total !== null && total <= budgetCents;
      candidate.budget = {
        applied: true,
        budgetCents,
        ok,
        remainingCents: total !== null ? budgetCents - total : null,
        basis:
          (fulfillment.effectiveMode === 'delivery'
            ? '含配送费/打包费的 data.price'
            : 'data.price（到店自取无配送费/打包费字段）') + (candidate.coupon?.applied ? '；券后价' : ''),
      };
      if (ok) kept.push(candidate);
      else {
        report.rejected.push({
          type: candidate.type,
          rule: candidate.rule,
          reason: '超预算',
          detail:
            `合计 ${yuan(total)}（${total} 分` +
            (candidate.coupon?.applied ? '，已用券' : '') +
            (fulfillment.effectiveMode === 'delivery' ? '，含配送费/打包费' : '') +
            `）> 预算 ${yuan(budgetCents)}（${budgetCents} 分）`,
        });
      }
    }
    report.candidates = kept;
  }

  const priceCalls = report.calls.filter((call) => call.tool === 'calculate-price');
  report.filters.push({
    id: 'sellable',
    label: '可售',
    applied: true,
    detail: `商品须在门店菜单内，且 calculate-price 返回同名同量；共算价 ${priceCalls.length} 次，失败 ${
      priceCalls.filter((call) => !call.ok).length
    } 次`,
  });

  report.filters.push({
    id: 'coupons',
    label: '门店券',
    applied: couponsMode === 'auto',
    detail:
      couponsMode !== 'auto'
        ? '未开启（--coupons auto 才查券）；所有价格都是无券价'
        : couponReport.error
          ? `券查询失败（${couponReport.error}），按无券继续，价格不受影响`
          : `扫描 ${couponReport.scanned} 张门店券：命中 ${couponReport.matched} 组、生效 ${couponReport.applied} 组；` +
            '券只让已选中的那一份更值，不换类型、不加商品、不组合多张券',
  });

  if (budgetCents !== null) {
    report.filters.push({
      id: 'budget',
      label: '预算',
      applied: true,
      detail:
        `上限 ${yuan(budgetCents)}（${budgetCents} 分），按 calculate-price 的 data.price 判断（开了券就按券后价）` +
        (fulfillment.effectiveMode === 'delivery' ? '；外送含配送费/打包费' : ''),
    });
  }

  report.summary = {
    mode: fulfillment.effectiveMode,
    fallbackCode: fulfillment.fallback ? fulfillment.fallback.code : null,
    candidateCount: report.candidates.length,
    types: report.candidates.map((item) => item.type),
    priceRange:
      report.candidates.length > 0
        ? {
            minCents: Math.min(...report.candidates.map((item) => item.price.totalCents)),
            maxCents: Math.max(...report.candidates.map((item) => item.price.totalCents)),
          }
        : null,
    integrityAllOk: report.candidates.every((item) => item.price.integrityOk),
    coupon: couponReport,
    callCount: report.calls.length,
    failureCount: report.failures.length,
    rejectedCount: report.rejected.length,
  };

  writeReport(outPath, report);

  // ---------------------------------------------------------------- 打印
  console.log(
    `菜单：${report.menu.categories.length} 个分类 / ${report.menu.itemCount} 个商品（${fulfillment.label}菜单）`,
  );
  console.log(
    `条件：${people} 人，预算 ${budgetCents === null ? '不限' : yuan(budgetCents)}，偏好排除 ${
      avoidTerms.join('、') || '无'
    }，券 ${couponsMode === 'auto' ? '自动' : '关'}`,
  );

  console.log(`\n候选 ${report.candidates.length} 组（固定类型顺序，非排序）：`);
  for (const candidate of report.candidates) {
    console.log(`\n  [${candidate.type}] ${candidate.price.totalYuan}（${candidate.price.totalCents} 分）— ${candidate.typeNote}`);
    console.log(`    规则：${candidate.rule}`);
    for (const item of candidate.items) {
      console.log(`    - ${item.name} ×${item.quantity}  ${item.subtotalYuan}`);
    }
    if (fulfillment.effectiveMode === 'delivery') {
      console.log(
        `    费用：商品 ${candidate.price.breakdown.productYuan} + 配送 ${candidate.price.breakdown.deliveryYuan} + 打包 ${candidate.price.breakdown.packingYuan}（字段直取）`,
      );
    }
    if (candidate.coupon?.applied) {
      console.log(
        `    券：${candidate.coupon.title}  券前 ${yuan(candidate.coupon.priceBeforeCouponCents)} → 券后 ${yuan(
          candidate.coupon.priceAfterCouponCents,
        )}（省 ${yuan(candidate.coupon.savingsCents)}）`,
      );
    }
    console.log(
      `    算价：price=${candidate.price.totalCents} 分 / discount=${candidate.price.discountCents} 分 / 一致性 ${
        candidate.price.integrityOk ? 'OK' : '异常'
      }`,
    );
  }

  if (report.rejected.length) {
    console.log('\n被剔除：');
    for (const item of report.rejected.slice(0, 12)) console.log(`  - [${item.type}] ${item.reason}：${item.detail || ''}`);
    if (report.rejected.length > 12) console.log(`  … 另有 ${report.rejected.length - 12} 条，见 data JSON`);
  }
  if (report.failures.length) {
    console.log('\n失败记录：');
    for (const item of report.failures) console.log(`  - ${item.tool}：${item.message}`);
  }

  console.log(`\n调用 ${report.summary.callCount} 次，失败 ${report.summary.failureCount} 次。`);
  console.log(`已写入：${outPath}`);

  if (report.candidates.length < 2) {
    console.error('\n[未达标] 候选少于 2 组，按规格需要 2–3 组。');
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`\n[错误] ${err.message}\n`);
  process.exitCode = 1;
});
