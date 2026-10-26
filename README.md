# POD Gate — revenue dashboard

Static, dependency-free dashboard for the **POD API-credit payment endpoint** on Base mainnet.

- **Endpoint:** `0x0009b5e129cbc8d731ba23d99e876faf517c257d` (UUPS proxy → `APICreditPayment`)
- **Treasury:** `0x8e35a75ab40270922ad16e003d426612cd23bef6` (4-of-7 Safe)
- **Chain:** Base, id 8453

## What it shows

1. Total revenue in USD, converted with **live CoinGecko rates** (`dolphin-2` → POD, `ethereum` → ETH)
2. Revenue broken down per payment rail (token), with share bars
3. An animated "incoming flow" visualisation of arrivals into the treasury
4. A transaction ledger — amount, token, rate, USD value, confirmations, payer, and a Basescan link per transaction

## How it works

No build step, no backend, no dependencies. Three files: `index.html`, `styles.css`, `app.js`.

- Payments are an embedded fixture (`PAYMENTS` in `app.js`) — every payment the endpoint has ever taken, verified on-chain.
- Prices are fetched from CoinGecko **in the browser** (60s cache in `localStorage`, stale-cache fallback).
- Confirmation counts come from a public Base RPC (`eth_blockNumber`, `eth_getTransactionReceipt`), and degrade gracefully when unavailable.
- `prefers-reduced-motion` renders a static scene instead of the animation.

## Adding a new payment

Append an entry to `PAYMENTS` in `app.js`:

```js
{
  hash: '0x…',            // transaction hash
  block: 12345678,        // block number
  ts: '2026-10-24T13:42:49.000Z',
  method: 'buyCredits',   // or buyCreditsWithETH
  payer: '0x…',
  rawAmount: '10366991499066970765',  // integer string, token units
  decimals: 18,
  token: { symbol: 'POD', name: 'Dolphin', cgId: 'dolphin-2', address: '0x…' },
}
```

For a new asset, add its CoinGecko id as `cgId` and a colour in `RAIL_COLOR`.

## Notes

- USD figures use **today's** rate, not the rate at payment time.
- The published site is public even though this repository is private.
