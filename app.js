'use strict';

/* ============================== POD GATE front-end ============================== */

const $ = (sel) => document.querySelector(sel);
const usdFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usdFmtSmall = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 4, maximumFractionDigits: 4 });
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const RAIL_COLOR = { POD: '#4d9dff', ETH: '#a78bfa', USDC: '#3d82f6', USDT: '#2aa985', VVV: '#ffc26b', xPOD: '#7c9cff' };

const state = { stats: null, loadedAt: null, error: null };

/* ------------------------------- helpers ------------------------------- */

const money = (v, small = false) => (v == null ? '—' : (small ? usdFmtSmall : usdFmt).format(v));

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
  return `${Math.round(m / 60)}h ago`;
}

function fmtDate(iso) {
  const d = new Date(iso);
  return {
    date: d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }),
    time: `${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })} UTC`,
  };
}

function animateNumber(el, to, formatter, duration = 850) {
  if (to == null) { el.textContent = '—'; return; }
  if (reduceMotion.matches) { el.textContent = formatter(to); return; }
  const from = 0;
  const start = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = formatter(from + (to - from) * eased);
    if (t < 1) requestAnimationFrame(step);
    else el.textContent = formatter(to);
  };
  requestAnimationFrame(step);
}

/* ------------------------------- render ------------------------------- */

function renderBanner() {
  const el = $('#banner');
  if (!state.error) { el.hidden = true; return; }
  el.hidden = false;
  el.dataset.kind = 'error';
  el.textContent = state.error;
}

function renderPrices(s) {
  const eth = s.prices.eth;
  const pod = s.prices.pod;
  $('#tickEth').textContent = eth == null ? '—' : money(eth);
  $('#tickPod').textContent = pod == null ? '—' : usdFmtSmall.format(pod);
  $('#rateEth').textContent = eth == null ? '—' : money(eth);
  $('#ratePod').textContent = pod == null ? '—' : usdFmtSmall.format(pod);
  $('#rateAge').textContent = s.prices.stale
    ? 'last good snapshot · live feed degraded'
    : `refreshed ${timeAgo(s.prices.updatedAt)} · every ${s.prices.ttlSeconds}s`;
}

function renderTotal(s) {
  const el = $('#totalUsd');
  const total = s.totals.usd;
  if (total == null) {
    el.textContent = '—';
    $('#totalSub').textContent = 'rate unavailable — retrying';
  } else {
    animateNumber(el, total, (v) => money(v));
    $('#totalSub').textContent = 'live CoinGecko conversion applied to on-chain intake';
  }
  const n = s.totals.payments;
  $('#totalMeta').textContent = `${n} arrival${n === 1 ? '' : 's'} · ${s.totals.pricedPayments}/${n} priced`;
}

function renderRails(s) {
  const ul = $('#rails');
  const total = s.totals.usd || 0;
  $('#railCount').textContent = `${s.perToken.length} rails`;
  ul.innerHTML = '';
  if (!s.perToken.length) {
    ul.innerHTML = '<li class="empty">No payments yet</li>';
    return;
  }
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
        <span class="rail-usd" style="color:var(--text)">${money(t.usd)}</span>
        <span class="rail-amt">${t.amount.toLocaleString('en-US', { maximumFractionDigits: 6 })} ${t.symbol}</span>
      </span>`;
    ul.appendChild(li);
  }
  $('#hudRails').textContent = `${s.perToken.length}/6`;
}

function renderGate(s) {
  $('#arrivalsVal').textContent = String(s.totals.payments);
  $('#heldVal').textContent = '0';
  const chip = $('#gateChip');
  const degraded = s.prices.stale || !s.chain.head;
  chip.textContent = degraded ? 'DEGRADED' : 'ONLINE';
  chip.className = `chip ${degraded ? 'warn' : 'ok'}`;
  if (s.endpoint) {
    const a = $('#gateAddr');
    a.href = s.endpoint.explorer;
    a.textContent = `${shortAddr(s.endpoint.address, 6, 4)} ↗`;
    $('#contractLink').href = s.endpoint.explorer;
  }
}

function renderLedger(s) {
  const host = $('#ledger');
  const rows = s.payments || [];
  $('#ledgerHint').textContent = `${rows.length} on-chain arrival${rows.length === 1 ? '' : 's'}`;
  if (!rows.length) {
    host.innerHTML = '<div class="empty">No payments have reached this endpoint yet.</div>';
    return;
  }
  const head = document.createElement('div');
  head.className = 'row head';
  head.innerHTML = `<span>When</span><span>Rail</span><span>Amount</span><span>USD value</span><span>Payer</span><span>Transaction</span>`;

  host.innerHTML = '';
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
  for (const p of s.payments || []) {
    const color = RAIL_COLOR[p.token.symbol] || 'var(--cyan)';
    const li = document.createElement('li');
    li.innerHTML = `<i style="background:${color};box-shadow:0 0 8px ${color}"></i>
      ${p.amountLabel} ${p.token.symbol} → <b style="color:var(--text)">${money(p.usd)}</b>
      <span style="color:var(--dim)">· ${shortAddr(p.payer, 5, 3)}</span>`;
    ul.appendChild(li);
  }
  $('#hudIntake').textContent = money(s.totals.usd);
}

function render(s) {
  state.stats = s;
  state.loadedAt = Date.now();
  renderPrices(s);
  renderTotal(s);
  renderRails(s);
  renderGate(s);
  renderLedger(s);
  renderLegend(s);
  $('#updatedNote').textContent = `prices from CoinGecko · updated ${timeAgo(s.prices.updatedAt)}`;
  startFlow(s.payments || []);
}

/* ------------------------------- flow canvas ------------------------------- */

const flow = { raf: 0, particles: [], pulses: [], t0: 0, payments: [], size: { w: 0, h: 0 }, nextSpawn: 0, idx: 0 };

function nodePositions(w, h) {
  const narrow = w < 520;
  return {
    core: { x: w * (narrow ? 0.72 : 0.79), y: h * (narrow ? 0.44 : 0.5) },
    sources: [
      { x: w * (narrow ? 0.2 : 0.13), y: h * (narrow ? 0.26 : 0.29) },
      { x: w * (narrow ? 0.2 : 0.13), y: h * (narrow ? 0.66 : 0.71) },
    ],
  };
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

function drawScene(ctx, w, h, opts = {}) {
  const { core, sources } = nodePositions(w, h);
  ctx.clearRect(0, 0, w, h);

  // faint scan grid
  ctx.strokeStyle = 'rgba(122,176,255,0.06)';
  ctx.lineWidth = 1;
  for (let x = 0; x < w; x += 48) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  for (let y = 0; y < h; y += 48) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }

  const used = Math.min(sources.length, Math.max(1, (opts.count || 1)));

  // rails
  for (let i = 0; i < used; i++) {
    const s = sources[i];
    const color = opts.colors?.[i] || '#5ee6ff';
    const midX = (s.x + core.x) / 2;
    const cp = { x: midX, y: s.y + (core.y - s.y) * 0.15 };
    ctx.beginPath();
    ctx.moveTo(s.x + 26, s.y);
    ctx.quadraticCurveTo(cp.x, cp.y, core.x - 30, core.y);
    ctx.setLineDash([4, 7]);
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = hexA(color, 0.32);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // core
  const t = opts.time || 0;
  for (let r = 0; r < 3; r++) {
    const rad = 34 + r * 15 + (opts.animate ? Math.sin(t / 700 + r) * 3 : 0);
    ctx.beginPath();
    ctx.arc(core.x, core.y, rad, 0, Math.PI * 2);
    ctx.strokeStyle = hexA('#5ee6ff', 0.30 - r * 0.08);
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }
  const g = ctx.createRadialGradient(core.x, core.y, 2, core.x, core.y, 62);
  g.addColorStop(0, 'rgba(94,230,255,0.55)');
  g.addColorStop(0.45, 'rgba(167,139,250,0.22)');
  g.addColorStop(1, 'rgba(94,230,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(core.x, core.y, 62, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(core.x, core.y, 20, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(8,14,26,0.95)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(94,230,255,0.85)';
  ctx.lineWidth = 1.6;
  ctx.stroke();

  ctx.font = '600 10px ui-monospace, Menlo, monospace';
  ctx.fillStyle = 'rgba(233,240,255,0.92)';
  ctx.textAlign = 'center';
  ctx.fillText('TREASURY', core.x, core.y + 46);
  ctx.fillStyle = 'rgba(107,127,156,0.9)';
  ctx.font = '9px ui-monospace, Menlo, monospace';
  ctx.fillText('0x8e35…BEF6', core.x, core.y + 59);

  // sources
  for (let i = 0; i < used; i++) {
    const s = sources[i];
    const color = opts.colors?.[i] || '#5ee6ff';
    ctx.beginPath();
    const R = 13;
    for (let k = 0; k < 6; k++) {
      const ang = (Math.PI / 3) * k - Math.PI / 6;
      const x = s.x + Math.cos(ang) * R;
      const y = s.y + Math.sin(ang) * R;
      k ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(8,14,26,0.95)';
    ctx.fill();
    ctx.strokeStyle = hexA(color, 0.95);
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(s.x, s.y, 3.2, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    ctx.textAlign = 'left';
    ctx.font = '600 10px ui-monospace, Menlo, monospace';
    ctx.fillStyle = hexA(color, 0.95);
    ctx.fillText(opts.labels?.[i] || '', s.x + 22, s.y - 4);
    ctx.fillStyle = 'rgba(107,127,156,0.85)';
    ctx.font = '9px ui-monospace, Menlo, monospace';
    ctx.fillText(opts.addrs?.[i] || '', s.x + 22, s.y + 9);
  }
}

function hexA(hex, a) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function bezier(s, core, t) {
  const midX = (s.x + core.x) / 2;
  const cp = { x: midX, y: s.y + (core.y - s.y) * 0.15 };
  const x = (1 - t) * (1 - t) * (s.x + 26) + 2 * (1 - t) * t * cp.x + t * t * (core.x - 30);
  const y = (1 - t) * (1 - t) * s.y + 2 * (1 - t) * t * cp.y + t * t * core.y;
  return { x, y };
}

function startFlow(payments) {
  cancelAnimationFrame(flow.raf);
  const ctx = setupCanvas();
  const { w, h } = flow.size;
  const { core, sources } = nodePositions(w, h);

  const railPayments = payments.slice(0, 2);
  const colors = railPayments.map((p) => RAIL_COLOR[p.token.symbol] || '#5ee6ff');
  const labels = railPayments.map((p) => p.token.symbol);
  const addrs = railPayments.map((p) => shortAddr(p.payer, 6, 4));

  const base = { count: railPayments.length, colors, labels, addrs, animate: !reduceMotion.matches };

  if (reduceMotion.matches) {
    drawScene(ctx, w, h, { ...base, animate: false });
    // static coins resting on the rails
    railPayments.forEach((p, i) => {
      for (const t of [0.36, 0.62, 0.86]) {
        const pt = bezier(sources[i], core, t);
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = colors[i];
        ctx.fill();
      }
    });
    return;
  }

  flow.payments = railPayments;
  flow.particles = [];
  flow.pulses = [];
  flow.t0 = performance.now();
  flow.nextSpawn = 0;
  flow.idx = 0;

  const loop = (now) => {
    const time = now - flow.t0;
    drawScene(ctx, w, h, { ...base, time });

    if (railPayments.length) {
      if (time > flow.nextSpawn) {
        const i = flow.idx % railPayments.length;
        flow.idx += 1;
        flow.nextSpawn = time + Math.max(1100, 2600 / Math.max(1, railPayments.length));
        flow.particles.push({ i, born: time, dur: 1500, usd: railPayments[i].usd, color: colors[i] });
      }
    }

    const core2 = core;
    flow.particles = flow.particles.filter((pt) => time - pt.born < pt.dur + 420);
    for (const pt of flow.particles) {
      const raw = (time - pt.born) / pt.dur;
      const t = Math.min(1, raw);
      const src = sources[pt.i % sources.length];
      const pos = bezier(src, core2, t);
      const landed = raw >= 1;
      const age = time - pt.born - pt.dur;

      if (!landed) {
        // trailing glow
        for (let k = 1; k <= 4; k++) {
          const tt = Math.max(0, t - k * 0.045);
          const trail = bezier(src, core2, tt);
          ctx.beginPath();
          ctx.arc(trail.x, trail.y, 5 - k * 0.9, 0, Math.PI * 2);
          ctx.fillStyle = hexA(pt.color, 0.22 - k * 0.045);
          ctx.fill();
        }
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 5.4, 0, Math.PI * 2);
        ctx.fillStyle = pt.color;
        ctx.shadowColor = pt.color;
        ctx.shadowBlur = 16;
        ctx.fill();
        ctx.shadowBlur = 0;
      } else if (age < 700) {
        if (!pt.fired) {
          pt.fired = true;
          flow.pulses.push({ born: time, color: pt.color });
        }
        const k = age / 700;
        ctx.beginPath();
        ctx.arc(core2.x, core2.y, 22 + k * 46, 0, Math.PI * 2);
        ctx.strokeStyle = hexA(pt.color, 0.55 * (1 - k));
        ctx.lineWidth = 2;
        ctx.stroke();
        if (pt.usd != null) {
          ctx.font = '700 12px ui-monospace, Menlo, monospace';
          ctx.textAlign = 'center';
          ctx.fillStyle = hexA(pt.color, 1 - k);
          ctx.fillText(`+${money(pt.usd)}`, core2.x, core2.y - 34 - k * 30);
        }
      }
    }

    // ambient pulses on the core
    for (const p of flow.pulses) {
      const k = (time - p.born) / 1100;
      if (k < 1) {
        ctx.beginPath();
        ctx.arc(core2.x, core2.y, 26 + k * 70, 0, Math.PI * 2);
        ctx.strokeStyle = hexA(p.color, 0.35 * (1 - k));
        ctx.lineWidth = 1.4;
        ctx.stroke();
      }
    }
    flow.pulses = flow.pulses.filter((p) => time - p.born < 1100);

    flow.raf = requestAnimationFrame(loop);
  };
  flow.raf = requestAnimationFrame(loop);
}

/* ------------------------------- data (static build) -------------------------------
   No backend: payments are embedded facts, prices come from CoinGecko (CORS-enabled),
   confirmations from a public Base RPC. Everything degrades gracefully if a fetch fails.
*/

const ENDPOINT = '0x0009b5e129cbc8d731ba23d99e876faf517c257d';
const TREASURY = '0x8e35a75ab40270922ad16e003d426612cd23bef6';
const IMPLEMENTATION = '0x087ea08d519a4f5100dbc096f77b67c20e4480af';
const PRICE_TTL_MS = 60_000;
const CACHE_KEY = 'podgate.prices.v1';

const PAYMENTS = [
  {
    hash: '0x1c0dff041806b072d9a2f86bfae6c1849c4298bbb1757cd3030b862d1ef09453',
    block: 53030011,
    ts: '2026-10-24T13:42:49.000Z',
    method: 'buyCredits',
    payer: '0x154f5e21835ad6d2bf2808577aeae5cba57c4710',
    rawAmount: '10366991499066970765',
    decimals: 18,
    token: { symbol: 'POD', name: 'Dolphin', cgId: 'dolphin-2', address: '0xed664536023d8e4b1640c394777d34abaff1df8f' },
  },
  {
    hash: '0x3615f146cdbfd02aa0414a7d848ebc0796f7b79193d88163815bd8ed03c7367e',
    block: 52991674,
    ts: '2026-10-23T16:24:55.000Z',
    method: 'buyCreditsWithETH',
    payer: '0x3549d5e347ad00a030a420037ff2ed780c805ab3',
    rawAmount: '2079457364341085',
    decimals: 18,
    token: { symbol: 'ETH', name: 'Ether', cgId: 'ethereum', address: '0x0000000000000000000000000000000000000000' },
  },
];

const round = (n, dp) => Math.round(n * 10 ** dp) / 10 ** dp;

function readPriceCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch { return null; }
}

function writePriceCache(data) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch { /* private mode */ }
}

async function fetchPrices(force = false) {
  const cached = readPriceCache();
  const fresh = cached && Date.now() - new Date(cached.updatedAt).getTime() < PRICE_TTL_MS;
  if (!force && fresh) return { ...cached, stale: false, error: null };

  try {
    const url = 'https://api.coingecko.com/api/v3/simple/price?ids=dolphin-2,ethereum&vs_currencies=usd';
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const data = {
      eth: json.ethereum ? json.ethereum.usd : null,
      pod: json['dolphin-2'] ? json['dolphin-2'].usd : null,
      updatedAt: new Date().toISOString(),
    };
    if (data.eth == null && data.pod == null) throw new Error('unexpected payload');
    writePriceCache(data);
    return { ...data, stale: false, error: null };
  } catch (err) {
    if (cached) return { ...cached, stale: true, error: err.message };
    return { eth: null, pod: null, updatedAt: null, stale: true, error: err.message };
  }
}

async function rpc(method, params) {
  const res = await fetch('https://mainnet.base.org', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`rpc ${res.status}`);
  const body = await res.json();
  if (body.error) throw new Error(body.error.message);
  return body.result;
}

async function fetchChain() {
  try {
    const head = parseInt(await rpc('eth_blockNumber', []), 16);
    const receipts = {};
    await Promise.all(PAYMENTS.map(async (p) => {
      try {
        const r = await rpc('eth_getTransactionReceipt', [p.hash]);
        receipts[p.hash] = r ? { status: parseInt(r.status, 16), block: parseInt(r.blockNumber, 16) } : null;
      } catch { receipts[p.hash] = null; }
    }));
    return { head, receipts, error: null };
  } catch (err) {
    return { head: null, receipts: {}, error: err.message };
  }
}

function buildStats({ prices, chain }) {
  const rate = (cgId) => (cgId === 'ethereum' ? prices.eth : cgId === 'dolphin-2' ? prices.pod : null);

  const rows = PAYMENTS.map((p) => {
    const amount = Number(p.rawAmount) / 10 ** p.decimals;
    const price = rate(p.token.cgId);
    const usd = typeof price === 'number' ? round(amount * price, 2) : null;
    const rcpt = chain.receipts[p.hash];
    return {
      hash: p.hash, ts: p.ts, block: p.block, method: p.method, payer: p.payer,
      token: p.token,
      amount,
      amountLabel: amount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 6 }),
      price: typeof price === 'number' ? price : null,
      usd,
      status: rcpt ? (rcpt.status === 1 ? 'confirmed' : 'failed') : 'unknown',
      confirmations: chain.head && rcpt ? Math.max(0, chain.head - rcpt.block) : null,
      explorer: `https://basescan.org/tx/${p.hash}`,
    };
  });

  const priced = rows.filter((r) => r.usd !== null);
  const totalUsd = priced.length ? round(priced.reduce((s, r) => s + r.usd, 0), 2) : null;

  const byToken = new Map();
  for (const r of rows) {
    const cur = byToken.get(r.token.symbol) || { symbol: r.token.symbol, name: r.token.name, amount: 0, usd: 0, priced: true, payments: 0 };
    cur.amount += r.amount;
    cur.payments += 1;
    if (r.usd === null) cur.priced = false; else cur.usd += r.usd;
    byToken.set(r.token.symbol, cur);
  }
  const perToken = [...byToken.values()]
    .map((t) => ({ ...t, amount: round(t.amount, 6), usd: t.priced ? round(t.usd, 2) : null, share: totalUsd && t.usd ? round((t.usd / totalUsd) * 100, 1) : null }))
    .sort((a, b) => (b.usd || 0) - (a.usd || 0));

  return {
    generatedAt: new Date().toISOString(),
    chainId: 8453,
    prices: { ...prices, source: 'coingecko', ttlSeconds: PRICE_TTL_MS / 1000 },
    chain: { head: chain.head, error: chain.error },
    totals: {
      usd: totalUsd,
      payments: rows.length,
      pricedPayments: priced.length,
      firstAt: rows.length ? rows[rows.length - 1].ts : null,
      lastAt: rows.length ? rows[0].ts : null,
    },
    perToken,
    payments: rows,
    endpoint: {
      address: ENDPOINT,
      implementation: IMPLEMENTATION,
      treasury: TREASURY,
      explorer: `https://basescan.org/address/${ENDPOINT}`,
    },
  };
}

async function load({ force = false } = {}) {
  const btn = $('#refresh');
  btn.disabled = true; btn.classList.add('busy');
  try {
    const prices = await fetchPrices(force);
    const chain = await fetchChain();
    state.error = null;
    renderBanner();
    render(buildStats({ prices, chain }));

    if (prices.error) {
      state.error = `Live rates unavailable (${prices.error})${prices.updatedAt ? ' — showing the last cached snapshot.' : '.'}`;
      renderBanner();
    } else if (chain.error) {
      state.error = `Chain read failed (${chain.error}) — confirmation counts may be stale.`;
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
window.addEventListener('resize', () => { if (state.stats) startFlow(state.stats.payments || []); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) cancelAnimationFrame(flow.raf);
  else if (state.stats) startFlow(state.stats.payments || []);
});
setInterval(() => {
  if (state.stats) {
    $('#updatedNote').textContent = `prices from CoinGecko · updated ${timeAgo(state.stats.prices.updatedAt)}`;
    $('#rateAge').textContent = state.stats.prices.stale
      ? 'last good snapshot · live feed degraded'
      : `refreshed ${timeAgo(state.stats.prices.updatedAt)} · every ${state.stats.prices.ttlSeconds}s`;
  }
}, 1000);
setInterval(() => load(), 60_000);

load();
