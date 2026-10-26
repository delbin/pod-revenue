'use strict';

/* ============================== POD GATE front-end ==============================
   Live data, no backend:
     • payments  ← Blockscout indexed APICreditsPurchased logs (CORS-enabled)
     • prices    ← CoinGecko (live, 60s cache)
     • status    ← Base RPC receipts + block head
   Degrades to the last cached snapshot, then to a bundled fixture.
*/

const $ = (sel) => document.querySelector(sel);
const usdFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usdFmtSmall = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 4, maximumFractionDigits: 4 });
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const RAIL_COLOR = { POD: '#4d9dff', ETH: '#a78bfa', USDC: '#3d82f6', USDT: '#2aa985', VVV: '#ffc26b', xPOD: '#7c9cff' };

/* ------------------------------- config ------------------------------- */

const ENDPOINT = '0x0009b5e129cbc8d731ba23d99e876faf517c257d';
const TREASURY = '0x8e35a75ab40270922ad16e003d426612cd23bef6';
const IMPLEMENTATION = '0x087ea08d519a4f5100dbc096f77b67c20e4480af';
const WHITELISTED_RAILS = 6;

const BLOCKSCOUT = 'https://base.blockscout.com/api/v2';
const RPC_URL = 'https://mainnet.base.org';
const COINGECKO = 'https://api.coingecko.com/api/v3';
const TOPIC_BUY = '0x93ece0a7f4cba426dcb3c786e68fb5fd9ce335d154c103376e160ab0dd00379f';
const ZERO = '0x0000000000000000000000000000000000000000';

const PRICE_TTL_MS = 60_000;
const KEY_PRICES = 'podgate.prices.v2';
const KEY_PAYMENTS = 'podgate.payments.v2';
const KEY_META = 'podgate.meta.v2';

// Verified fixture — only used when the live feed is unreachable on a cold cache.
const FIXTURE = [
  { hash: '0x1c0dff041806b072d9a2f86bfae6c1849c4298bbb1757cd3030b862d1ef09453', block: 53030011, ts: '2026-10-24T13:42:49.000Z', payer: '0x154f5e21835ad6d2bf2808577aeae5cba57c4710', tokenAddress: '0xed664536023d8e4b1640c394777d34abaff1df8f', rawAmount: '10366991499066970765' },
  { hash: '0x3615f146cdbfd02aa0414a7d848ebc0796f7b79193d88163815bd8ed03c7367e', block: 52991674, ts: '2026-10-23T16:24:55.000Z', payer: '0x3549d5e347ad00a030a420037ff2ed780c805ab3', tokenAddress: ZERO, rawAmount: '2079457364341085' },
];

// Every asset whitelisted on the endpoint. CoinGecko's /coins/base/contract/<address>
// lookup is *not* CORS-enabled, so ids are pinned here (verified against CoinGecko).
const KNOWN_TOKENS = {
  [ZERO]: { symbol: 'ETH', name: 'Ether', decimals: 18, cgId: 'ethereum' },
  '0xed664536023d8e4b1640c394777d34abaff1df8f': { symbol: 'POD', name: 'Dolphin', decimals: 18, cgId: 'dolphin-2' },
  '0xec29311253d37c9682fb7f86fe863202f6f4f988': { symbol: 'xPOD', name: 'xPOD vault', decimals: 18, cgId: null },
  '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': { symbol: 'USDC', name: 'USD Coin', decimals: 6, cgId: 'usd-coin' },
  '0xfde4c96c8593536e31f229ea8f37b2ada2699bb2': { symbol: 'USDT', name: 'Tether USD', decimals: 6, cgId: 'l2-standard-bridged-usdt-base' },
  '0xacfe6019ed1a7dc6f7b508c02d1b04ec88cc21bf': { symbol: 'VVV', name: 'Venice Token', decimals: 18, cgId: 'venice-token' },
};

const state = { stats: null, error: null };

/* ------------------------------- helpers ------------------------------- */

const money = (v, small = false) => (v == null ? '—' : (small ? usdFmtSmall : usdFmt).format(v));
const round = (n, dp) => Math.round(n * 10 ** dp) / 10 ** dp;

function shortAddr(a, front = 6, back = 4) {
  if (!a) return '—';
  return `${a.slice(0, front)}…${a.slice(-back)}`;
}

function timeAgo(iso) {
  if (!iso) return '—';
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

function fmtDate(iso) {
  const d = new Date(iso);
  return {
    date: d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }),
    time: `${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })} UTC`,
  };
}

const amountText = (v) => v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 6 });

function animateNumber(el, to, formatter, duration = 850) {
  if (to == null) { el.textContent = '—'; return; }
  if (reduceMotion.matches) { el.textContent = formatter(to); return; }
  const start = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = formatter(to * eased);
    if (t < 1) requestAnimationFrame(step);
    else el.textContent = formatter(to);
  };
  requestAnimationFrame(step);
}

function readCache(key) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
function writeCache(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
}

async function getJson(url, timeoutMs = 9000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctl.signal, headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally { clearTimeout(t); }
}

async function rpc(method, params) {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(9000),
  });
  if (!res.ok) throw new Error(`rpc ${res.status}`);
  const body = await res.json();
  if (body.error) throw new Error(body.error.message || 'rpc error');
  return body.result;
}

function decodeAbiString(hex) {
  try {
    const raw = String(hex).slice(2);
    if (raw.length < 128) return null;
    const len = parseInt(raw.slice(64, 128), 16);
    if (!len || len > 96) return null;
    const bytes = raw.slice(128, 128 + len * 2);
    return decodeURIComponent(bytes.replace(/../g, '%$&')).replace(/\u0000/g, '');
  } catch { return null; }
}

/* ------------------------------- token metadata ------------------------------- */

const metaCache = readCache(KEY_META) || {};

async function tokenMeta(address) {
  const key = String(address).toLowerCase();
  if (KNOWN_TOKENS[key]) return KNOWN_TOKENS[key];
  if (metaCache[key]) return metaCache[key];

  let decimals = 18;
  let symbol = shortAddr(key, 4, 4);
  let cgId = null;
  try {
    decimals = Number(BigInt(await rpc('eth_call', [{ to: key, data: '0x313ce567' }, 'latest'])));
    if (!Number.isFinite(decimals) || decimals > 36) decimals = 18;
  } catch { /* default 18 */ }
  try {
    const s = decodeAbiString(await rpc('eth_call', [{ to: key, data: '0x95d89b41' }, 'latest']));
    if (s) symbol = s;
  } catch { /* keep short address */ }
  const meta = { symbol, name: symbol, decimals, cgId };
  metaCache[key] = meta;
  writeCache(KEY_META, metaCache);
  return meta;
}

/* ------------------------------- payments (Blockscout) ------------------------------- */

async function fetchPaymentsLive() {
  const items = [];
  let url = `${BLOCKSCOUT}/addresses/${ENDPOINT}/logs`;
  for (let page = 0; page < 6 && url; page++) {
    const json = await getJson(url);
    items.push(...(json.items || []));
    if (!json.next_page_params) break;
    url = `${BLOCKSCOUT}/addresses/${ENDPOINT}/logs?${new URLSearchParams(json.next_page_params).toString()}`;
  }

  const events = items.filter((l) => (l.topics || [])[0] === TOPIC_BUY && l.decoded && l.decoded.parameters);
  if (!events.length) throw new Error('no payment events returned');

  const rows = events.map((l) => {
    const p = Object.fromEntries(l.decoded.parameters.map((x) => [x.name, x.value]));
    return {
      hash: l.transaction_hash,
      block: l.block_number,
      ts: l.block_timestamp,
      payer: p.payer,
      tokenAddress: String(p.paymentToken).toLowerCase(),
      rawAmount: String(p.amount),
    };
  });

  // de-duplicate by tx hash (paginated feeds can overlap at page boundaries)
  const unique = [...new Map(rows.map((r) => [r.hash.toLowerCase(), r])).values()];
  unique.sort((a, b) => new Date(b.ts) - new Date(a.ts));
  return unique;
}

async function resolvePayments() {
  try {
    const rows = await fetchPaymentsLive();
    writeCache(KEY_PAYMENTS, { at: new Date().toISOString(), rows });
    return { rows, source: 'live' };
  } catch (err) {
    const cached = readCache(KEY_PAYMENTS);
    if (cached && cached.rows && cached.rows.length) return { rows: cached.rows, source: `cached snapshot (${err.message})` };
    return { rows: FIXTURE, source: `bundled snapshot (${err.message})` };
  }
}

/* ------------------------------- prices ------------------------------- */

async function fetchPrices(cgIds, force = false) {
  const ids = [...new Set(['ethereum', 'dolphin-2', ...cgIds.filter(Boolean)])].sort();
  const signature = ids.join(',');
  const cached = readCache(KEY_PRICES);
  const fresh = cached && cached.ids === signature && Date.now() - new Date(cached.updatedAt).getTime() < PRICE_TTL_MS;
  if (!force && fresh) return { map: cached.map, updatedAt: cached.updatedAt, stale: false, error: null };

  try {
    const j = await getJson(`${COINGECKO}/simple/price?ids=${signature}&vs_currencies=usd`);
    const map = {};
    for (const id of ids) if (j[id] && typeof j[id].usd === 'number') map[id] = j[id].usd;
    if (!Object.keys(map).length) throw new Error('no usable prices');
    const payload = { ids: signature, map, updatedAt: new Date().toISOString() };
    writeCache(KEY_PRICES, payload);
    return { map, updatedAt: payload.updatedAt, stale: false, error: null };
  } catch (err) {
    if (cached && cached.map) return { map: cached.map, updatedAt: cached.updatedAt, stale: true, error: err.message };
    return { map: {}, updatedAt: null, stale: true, error: err.message };
  }
}

/* ------------------------------- chain status ------------------------------- */

async function fetchChain(rows) {
  try {
    const head = parseInt(await rpc('eth_blockNumber', []), 16);
    const receipts = {};
    await Promise.all(rows.slice(0, 20).map(async (r) => {
      try {
        const rc = await rpc('eth_getTransactionReceipt', [r.hash]);
        receipts[r.hash] = rc ? parseInt(rc.status, 16) : null;
      } catch { receipts[r.hash] = null; }
    }));
    return { head, receipts, error: null };
  } catch (err) {
    return { head: null, receipts: {}, error: err.message };
  }
}

/* ------------------------------- model ------------------------------- */

async function buildStats({ force = false } = {}) {
  const { rows, source } = await resolvePayments();
  const metas = await Promise.all(rows.map((r) => tokenMeta(r.tokenAddress)));
  const prices = await fetchPrices(metas.map((m) => m.cgId), force);
  const chain = await fetchChain(rows);

  const payments = rows.map((r, i) => {
    const meta = metas[i];
    const amount = Number(r.rawAmount) / 10 ** meta.decimals;
    const price = meta.cgId && typeof prices.map[meta.cgId] === 'number' ? prices.map[meta.cgId] : null;
    const usd = price == null ? null : round(amount * price, 2);
    return {
      hash: r.hash,
      ts: r.ts,
      block: r.block,
      payer: r.payer,
      method: r.tokenAddress === ZERO ? 'buyCreditsWithETH' : 'buyCredits',
      token: { symbol: meta.symbol, address: r.tokenAddress },
      amount,
      amountLabel: amountText(amount),
      price,
      usd,
      confirmations: chain.head ? Math.max(0, chain.head - r.block) : null,
      status: chain.receipts[r.hash] === 0 ? 'failed' : 'confirmed',
      explorer: `https://basescan.org/tx/${r.hash}`,
    };
  });

  const priced = payments.filter((p) => p.usd != null);
  const totalUsd = priced.length ? round(priced.reduce((s, p) => s + p.usd, 0), 2) : null;

  const byToken = new Map();
  for (const p of payments) {
    const cur = byToken.get(p.token.symbol) || { symbol: p.token.symbol, amount: 0, usd: 0, priced: true, payments: 0 };
    cur.amount += p.amount;
    cur.payments += 1;
    if (p.usd == null) cur.priced = false; else cur.usd += p.usd;
    byToken.set(p.token.symbol, cur);
  }
  const perToken = [...byToken.values()]
    .map((t) => ({ ...t, amount: round(t.amount, 6), usd: t.priced ? round(t.usd, 2) : null }))
    .sort((a, b) => (b.usd || 0) - (a.usd || 0));

  return {
    generatedAt: new Date().toISOString(),
    source,
    prices: { map: prices.map, updatedAt: prices.updatedAt, stale: prices.stale, error: prices.error, ttlSeconds: PRICE_TTL_MS / 1000 },
    chain: { head: chain.head, error: chain.error },
    totals: { usd: totalUsd, payments: payments.length, priced: priced.length, latest: payments.length ? payments[0].ts : null },
    perToken,
    payments,
    endpoint: { address: ENDPOINT, implementation: IMPLEMENTATION, treasury: TREASURY, explorer: `https://basescan.org/address/${ENDPOINT}` },
  };
}

/* ------------------------------- render ------------------------------- */

function renderBanner() {
  const el = $('#banner');
  if (!state.error) { el.hidden = true; return; }
  el.hidden = false;
  el.dataset.kind = 'error';
  el.textContent = state.error;
}

function priceForToken(s, t) {
  if (t.symbol === 'ETH') return s.prices.map.ethereum ?? null;
  if (t.symbol === 'POD') return s.prices.map['dolphin-2'] ?? null;
  return t.priced && t.amount ? t.usd / t.amount : null;
}

function renderTickers(s) {
  const host = $('#tickers');
  const eth = s.prices.map.ethereum;
  const secondary = s.perToken.find((t) => t.symbol !== 'ETH');
  const secondPrice = secondary ? priceForToken(s, secondary) : null;
  host.innerHTML = `
    <span class="ticker live"><i class="dot"></i>LIVE</span>
    <span class="ticker">ETH <b>${eth == null ? '—' : money(eth)}</b></span>
    ${secondary ? `<span class="ticker">${secondary.symbol} <b>${secondPrice == null ? '—' : usdFmtSmall.format(secondPrice)}</b></span>` : ''}`;
}

function renderTotal(s) {
  const el = $('#totalUsd');
  if (s.totals.usd == null) {
    el.textContent = '—';
    $('#totalSub').textContent = 'rate unavailable — retrying';
  } else {
    animateNumber(el, s.totals.usd, (v) => money(v));
    $('#totalSub').textContent = 'live CoinGecko conversion applied to on-chain intake';
  }
  const n = s.totals.payments;
  const unpriced = n - s.totals.priced;
  $('#totalMeta').textContent = `${n} arrival${n === 1 ? '' : 's'} · ${s.totals.priced}/${n} priced`
    + (unpriced ? ` · ${unpriced} unpriced, not in total` : '') + ` · latest ${timeAgo(s.totals.latest)}`;
}

function renderRails(s) {
  const ul = $('#rails');
  const total = s.totals.usd || 0;
  $('#railCount').textContent = `${s.perToken.length} rail${s.perToken.length === 1 ? '' : 's'}`;
  ul.innerHTML = s.perToken.length ? '' : '<li class="empty">No payments yet</li>';
  for (const t of s.perToken) {
    const color = RAIL_COLOR[t.symbol] || 'var(--cyan)';
    const pct = t.usd != null && total ? Math.max(2, Math.round((t.usd / total) * 100)) : 0;
    const li = document.createElement('li');
    li.className = 'rail-row';
    li.style.color = color;
    li.innerHTML = `
      <span class="rail-tag"><i></i>${t.symbol}</span>
      <span class="rail-bar"><span style="width:${pct}%"></span></span>
      <span>
        <span class="rail-usd" style="color:${t.usd == null ? 'var(--muted)' : 'var(--text)'}">${t.usd == null ? 'unpriced' : money(t.usd)}</span>
        <span class="rail-amt">${amountText(t.amount)} ${t.symbol}</span>
      </span>`;
    ul.appendChild(li);
  }
  $('#hudRails').textContent = `${s.perToken.length}/${Math.max(WHITELISTED_RAILS, s.perToken.length)}`;
}

function renderRates(s) {
  const host = $('#rates');
  host.innerHTML = s.perToken.slice(0, 5).map((t) => {
    const p = priceForToken(s, t);
    return `<li><span class="rate-k">${t.symbol}</span><span class="rate-v">${p == null ? '<span class="muted-small">unpriced</span>' : (p < 1 ? usdFmtSmall.format(p) : money(p))}</span></li>`;
  }).join('') || '<li><span class="rate-k">—</span><span class="rate-v">—</span></li>';
  $('#rateAge').textContent = s.prices.stale
    ? 'last good snapshot · live feed degraded'
    : `refreshed ${timeAgo(s.prices.updatedAt)} · every ${s.prices.ttlSeconds}s`;
}

function renderGate(s) {
  $('#arrivalsVal').textContent = String(s.totals.payments);
  $('#heldVal').textContent = '0';
  const chip = $('#gateChip');
  const degraded = s.prices.stale || !s.chain.head || s.source !== 'live';
  chip.textContent = degraded ? 'DEGRADED' : 'ONLINE';
  chip.className = `chip ${degraded ? 'warn' : 'ok'}`;
  const a = $('#gateAddr');
  a.href = s.endpoint.explorer;
  a.textContent = `${shortAddr(s.endpoint.address, 6, 4)} ↗`;
  $('#contractLink').href = s.endpoint.explorer;
}

function renderLedger(s) {
  const host = $('#ledger');
  const rows = s.payments || [];
  $('#ledgerHint').textContent = `${rows.length} on-chain arrival${rows.length === 1 ? '' : 's'}`;
  if (!rows.length) {
    host.innerHTML = '<div class="empty">No payments have reached this endpoint yet.</div>';
    return;
  }
  host.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'row head';
  head.innerHTML = `<span>When</span><span>Rail</span><span>Amount</span><span>USD value</span><span>Payer</span><span>Transaction</span>`;
  host.appendChild(head);

  for (const p of rows) {
    const d = fmtDate(p.ts);
    const color = RAIL_COLOR[p.token.symbol] || 'var(--cyan)';
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `
      <div class="cell whencell">
        <span class="cell-k">When</span>
        <span class="when">${d.date}<small>${d.time}</small></span>
      </div>
      <div class="cell">
        <span class="cell-k">Rail</span>
        <span class="railname" style="color:${color}"><i></i>${p.token.symbol}</span>
        <span class="method">${p.method}</span>
      </div>
      <div class="cell">
        <span class="cell-k">Amount</span>
        <span class="amt">${p.amountLabel} <small>${p.token.symbol}</small></span>
        <span class="method">rate ${p.price == null ? '—' : (p.price < 1 ? usdFmtSmall.format(p.price) : money(p.price))}</span>
      </div>
      <div class="cell">
        <span class="cell-k">USD value</span>
        <span class="usdcell">${money(p.usd)}</span>
        <span class="method">${p.confirmations == null ? 'block ' + p.block.toLocaleString('en-US') : p.confirmations.toLocaleString('en-US') + ' conf.'}</span>
      </div>
      <div class="cell">
        <span class="cell-k">Payer</span>
        <span class="payer" title="${p.payer}">${shortAddr(p.payer)}</span>
        <span class="method"><span class="status"><i></i>${p.status}</span></span>
      </div>
      <div class="cell txcell">
        <a class="tx-link" href="${p.explorer}" target="_blank" rel="noopener noreferrer">Basescan ↗</a>
      </div>`;
    host.appendChild(row);
  }
}

function renderLegend(s) {
  const ul = $('#flowLegend');
  ul.innerHTML = '';
  for (const p of (s.payments || []).slice(0, 6)) {
    const color = RAIL_COLOR[p.token.symbol] || 'var(--cyan)';
    const li = document.createElement('li');
    li.innerHTML = `<i style="background:${color};box-shadow:0 0 8px ${color}"></i>
      ${p.amountLabel} ${p.token.symbol} → <b style="color:var(--text)">${money(p.usd)}</b>
      <span style="color:var(--dim)">· ${shortAddr(p.payer, 5, 3)} · ${timeAgo(p.ts)}</span>`;
    ul.appendChild(li);
  }
  $('#hudIntake').textContent = money(s.totals.usd);
}

function render(s) {
  state.stats = s;
  renderTickers(s);
  renderTotal(s);
  renderRails(s);
  renderRates(s);
  renderGate(s);
  renderLedger(s);
  renderLegend(s);
  $('#updatedNote').textContent = `live · Blockscout + CoinGecko · updated ${timeAgo(s.prices.updatedAt || s.generatedAt)}`;
  startFlow(s.perToken, s.payments);
}

/* ------------------------------- flow canvas ------------------------------- */

const flow = { raf: 0, particles: [], pulses: [], t0: 0, nextSpawn: 0, idx: 0 };

function nodePositions(w, h, count) {
  const narrow = w < 520;
  const top = narrow ? 0.2 : 0.24;
  const bottom = narrow ? 0.74 : 0.78;
  const sources = [];
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    sources.push({ x: w * (narrow ? 0.2 : 0.13), y: h * (top + (bottom - top) * t) });
  }
  return { core: { x: w * (narrow ? 0.72 : 0.79), y: h * (narrow ? 0.44 : 0.5) }, sources };
}

function setupCanvas() {
  const c = $('#flow');
  const rect = c.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = Math.max(1, Math.round(rect.width * dpr));
  c.height = Math.max(1, Math.round(rect.height * dpr));
  const ctx = c.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  flow.size = { w: rect.width, h: rect.height };
  return ctx;
}

function hexA(hex, a) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function curve(s, core, t) {
  const cp = { x: (s.x + core.x) / 2, y: s.y + (core.y - s.y) * 0.15 };
  return {
    x: (1 - t) * (1 - t) * (s.x + 26) + 2 * (1 - t) * t * cp.x + t * t * (core.x - 30),
    y: (1 - t) * (1 - t) * s.y + 2 * (1 - t) * t * cp.y + t * t * core.y,
  };
}

function drawScene(ctx, w, h, o) {
  const { core, sources } = nodePositions(w, h, o.rails.length);
  ctx.clearRect(0, 0, w, h);

  ctx.strokeStyle = 'rgba(122,176,255,0.06)';
  ctx.lineWidth = 1;
  for (let x = 0; x < w; x += 48) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  for (let y = 0; y < h; y += 48) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }

  o.rails.forEach((rail, i) => {
    const s = sources[i];
    if (!s) return;
    ctx.beginPath();
    ctx.moveTo(s.x + 26, s.y);
    ctx.quadraticCurveTo((s.x + core.x) / 2, s.y + (core.y - s.y) * 0.15, core.x - 30, core.y);
    ctx.setLineDash([4, 7]);
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = hexA(rail.color, 0.32);
    ctx.stroke();
    ctx.setLineDash([]);
  });

  const t = o.time || 0;
  for (let r = 0; r < 3; r++) {
    ctx.beginPath();
    ctx.arc(core.x, core.y, 34 + r * 15 + (o.animate ? Math.sin(t / 700 + r) * 3 : 0), 0, Math.PI * 2);
    ctx.strokeStyle = hexA('#5ee6ff', 0.30 - r * 0.08);
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }
  const g = ctx.createRadialGradient(core.x, core.y, 2, core.x, core.y, 62);
  g.addColorStop(0, 'rgba(94,230,255,0.55)');
  g.addColorStop(0.45, 'rgba(167,139,250,0.22)');
  g.addColorStop(1, 'rgba(94,230,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(core.x, core.y, 62, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(core.x, core.y, 20, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(8,14,26,0.95)'; ctx.fill();
  ctx.strokeStyle = 'rgba(94,230,255,0.85)'; ctx.lineWidth = 1.6; ctx.stroke();

  ctx.textAlign = 'center';
  ctx.font = '600 10px ui-monospace, Menlo, monospace';
  ctx.fillStyle = 'rgba(233,240,255,0.92)';
  ctx.fillText('TREASURY', core.x, core.y + 46);
  ctx.fillStyle = 'rgba(107,127,156,0.9)';
  ctx.font = '9px ui-monospace, Menlo, monospace';
  ctx.fillText('0x8e35…BEF6', core.x, core.y + 59);

  o.rails.forEach((rail, i) => {
    const s = sources[i];
    if (!s) return;
    ctx.beginPath();
    for (let k = 0; k < 6; k++) {
      const ang = (Math.PI / 3) * k - Math.PI / 6;
      const x = s.x + Math.cos(ang) * 13;
      const y = s.y + Math.sin(ang) * 13;
      k ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(8,14,26,0.95)'; ctx.fill();
    ctx.strokeStyle = hexA(rail.color, 0.95); ctx.lineWidth = 1.6; ctx.stroke();
    ctx.beginPath(); ctx.arc(s.x, s.y, 3.2, 0, Math.PI * 2);
    ctx.fillStyle = rail.color; ctx.fill();

    ctx.textAlign = 'left';
    ctx.font = '600 10px ui-monospace, Menlo, monospace';
    ctx.fillStyle = hexA(rail.color, 0.95);
    ctx.fillText(rail.symbol, s.x + 22, s.y - 4);
    ctx.fillStyle = 'rgba(107,127,156,0.85)';
    ctx.font = '9px ui-monospace, Menlo, monospace';
    ctx.fillText(rail.label, s.x + 22, s.y + 9);
  });
}

function startFlow(perToken, payments) {
  cancelAnimationFrame(flow.raf);
  const ctx = setupCanvas();
  const { w, h } = flow.size;

  const rails = (perToken || []).slice(0, 6).map((t) => ({
    symbol: t.symbol,
    color: RAIL_COLOR[t.symbol] || '#5ee6ff',
    label: `${amountText(t.amount)} ${t.symbol}`,
  }));
  const railIndex = new Map(rails.map((r, i) => [r.symbol, i]));

  const items = (payments || []).slice(0, 8)
    .filter((p) => railIndex.has(p.token.symbol))
    .map((p) => ({
      rail: railIndex.get(p.token.symbol),
      usd: p.usd,
      color: RAIL_COLOR[p.token.symbol] || '#5ee6ff',
    }));

  const scene = { rails, animate: !reduceMotion.matches };

  if (reduceMotion.matches) {
    drawScene(ctx, w, h, { ...scene, animate: false });
    const { core, sources } = nodePositions(w, h, rails.length);
    items.forEach((p) => {
      const s = sources[p.rail];
      if (!s) return;
      for (const t of [0.36, 0.62, 0.86]) {
        const pt = curve(s, core, t);
        ctx.beginPath(); ctx.arc(pt.x, pt.y, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = p.color; ctx.fill();
      }
    });
    return;
  }

  flow.particles = [];
  flow.pulses = [];
  flow.t0 = performance.now();
  flow.nextSpawn = 0;
  flow.idx = 0;
  flow.items = items;

  const loop = (now) => {
    const time = now - flow.t0;
    drawScene(ctx, w, h, { ...scene, time });
    const { core, sources } = nodePositions(w, h, rails.length);

    if (items.length && time > flow.nextSpawn) {
      const p = items[flow.idx % items.length];
      flow.idx += 1;
      flow.nextSpawn = time + Math.max(900, 2800 / Math.max(1, items.length));
      flow.particles.push({ ...p, born: time, dur: 1500 });
    }

    flow.particles = flow.particles.filter((pt) => time - pt.born < 1920);
    for (const pt of flow.particles) {
      const src = sources[pt.rail];
      if (!src) continue;
      const raw = (time - pt.born) / pt.dur;
      const t = Math.min(1, raw);
      const pos = curve(src, core, t);
      const age = time - pt.born - pt.dur;

      if (raw < 1) {
        for (let k = 1; k <= 4; k++) {
          const trail = curve(src, core, Math.max(0, t - k * 0.045));
          ctx.beginPath(); ctx.arc(trail.x, trail.y, 5 - k * 0.9, 0, Math.PI * 2);
          ctx.fillStyle = hexA(pt.color, 0.22 - k * 0.045); ctx.fill();
        }
        ctx.beginPath(); ctx.arc(pos.x, pos.y, 5.4, 0, Math.PI * 2);
        ctx.fillStyle = pt.color; ctx.shadowColor = pt.color; ctx.shadowBlur = 16; ctx.fill(); ctx.shadowBlur = 0;
      } else if (age < 700) {
        if (!pt.fired) { pt.fired = true; flow.pulses.push({ born: time, color: pt.color }); }
        const k = age / 700;
        ctx.beginPath(); ctx.arc(core.x, core.y, 22 + k * 46, 0, Math.PI * 2);
        ctx.strokeStyle = hexA(pt.color, 0.55 * (1 - k)); ctx.lineWidth = 2; ctx.stroke();
        if (pt.usd != null) {
          ctx.font = '700 12px ui-monospace, Menlo, monospace';
          ctx.textAlign = 'center';
          ctx.fillStyle = hexA(pt.color, 1 - k);
          ctx.fillText(`+${money(pt.usd)}`, core.x, core.y - 34 - k * 30);
        }
      }
    }

    for (const p of flow.pulses) {
      const k = (time - p.born) / 1100;
      if (k < 1) {
        ctx.beginPath(); ctx.arc(core.x, core.y, 26 + k * 70, 0, Math.PI * 2);
        ctx.strokeStyle = hexA(p.color, 0.35 * (1 - k)); ctx.lineWidth = 1.4; ctx.stroke();
      }
    }
    flow.pulses = flow.pulses.filter((p) => time - p.born < 1100);

    flow.raf = requestAnimationFrame(loop);
  };
  flow.raf = requestAnimationFrame(loop);
}

/* ------------------------------- boot ------------------------------- */

async function load({ force = false, silent = false } = {}) {
  const btn = $('#refresh');
  if (!silent) { btn.disabled = true; btn.classList.add('busy'); }
  try {
    const stats = await buildStats({ force });
    state.error = null;
    renderBanner();
    render(stats);

    if (stats.source !== 'live') {
      state.error = `Live on-chain feed unavailable — showing ${stats.source}.`;
      renderBanner();
    } else if (stats.prices.stale) {
      state.error = `Live rates unavailable (${stats.prices.error}) — using the last cached snapshot.`;
      renderBanner();
    }
  } catch (err) {
    state.error = `Could not load data (${err.message}).`;
    renderBanner();
  } finally {
    btn.disabled = false; btn.classList.remove('busy');
  }
}

$('#refresh').addEventListener('click', () => load({ force: true }));
window.addEventListener('resize', () => { if (state.stats) startFlow(state.stats.perToken, state.stats.payments); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) cancelAnimationFrame(flow.raf);
  else if (state.stats) startFlow(state.stats.perToken, state.stats.payments);
});
setInterval(() => {
  if (!state.stats) return;
  $('#updatedNote').textContent = `live · Blockscout + CoinGecko · updated ${timeAgo(state.stats.prices.updatedAt || state.stats.generatedAt)}`;
  $('#rateAge').textContent = state.stats.prices.stale
    ? 'last good snapshot · live feed degraded'
    : `refreshed ${timeAgo(state.stats.prices.updatedAt)} · every ${state.stats.prices.ttlSeconds}s`;
}, 1000);
setInterval(() => load({ silent: true }), 60_000);

load();
