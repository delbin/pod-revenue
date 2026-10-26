# POD Gate — revenue dashboard

Live, dependency-free dashboard for the **POD API-credit payment endpoint** on Base mainnet.

- **Endpoint:** `0x0009b5e129cbc8d731ba23d99e876faf517c257d` (UUPS proxy → `APICreditPayment`)
- **Treasury:** `0x8e35a75ab40270922ad16e003d426612cd23bef6` (4-of-7 Safe)
- **Chain:** Base, id 8453

## What it shows

1. Total revenue in USD, converted with **live CoinGecko rates** (`dolphin-2` → POD, `ethereum` → ETH)
2. Revenue broken down per payment rail (token), with share bars
3. An animated "incoming flow" visualisation of arrivals into the treasury
4. A transaction ledger — amount, token, rate, USD value, confirmations, payer, and a Basescan link per transaction

## How it works — it updates itself

No build step, no backend, no dependencies. Three files: `index.html`, `styles.css`, `app.js`.

| Data | Source | Refresh |
|---|---|---|
| Payments | Blockscout indexed `APICreditsPurchased` logs (`/api/v2/addresses/<endpoint>/logs`) | every 60s |
| USD prices | CoinGecko (`simple/price`, ids resolved per token) | every 60s, `localStorage` cache |
| Confirmations | Base public RPC (`eth_blockNumber`, `eth_getTransactionReceipt`) | every 60s |

**A new payment appears on its own within a minute — no rebuild, no commit.** The ledger, per-rail
totals, USD total and the flow animation all recompute from whatever the feed returns.

Token metadata is resolved at runtime: unlisted tokens get `symbol()`/`decimals()` from the RPC and a
CoinGecko id from `/coins/base/contract/<address>`, so a new asset shows up priced without a code change.

### Failure behaviour

Blockscout unreachable → last good response from `localStorage` → bundled fixture, with a banner
saying which one is being shown. CoinGecko unreachable → last cached prices, values stay visible and
the card reads `DEGRADED`. The page never goes blank.

## Editing

- Colours per rail: `RAIL_COLOR` in `app.js`
- Known symbol/decimals/CoinGecko ids: `KNOWN_TOKENS` (others are auto-resolved)
- Poll interval: the `setInterval(... 60_000)` at the bottom of `app.js`
- `prefers-reduced-motion` renders a static scene instead of the animation.

## Notes

- USD figures use **today's** rate, not the rate at payment time.
- The published site is public even though this repository is private.
