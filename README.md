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

### Supported rails

All six assets whitelisted on the endpoint render as their own rail:

| Rail | Token contract | Decimals | Price source |
|---|---|---|---|
| POD | `0xed66…f8f` | 18 | CoinGecko `dolphin-2` |
| ETH | native (`address(0)`) | 18 | CoinGecko `ethereum` |
| USDC | `0x8335…913` | 6 | CoinGecko `usd-coin` |
| USDT | `0xfde4…bb2` | 6 | CoinGecko `l2-standard-bridged-usdt-base` |
| VVV | `0xacfe…1bf` | 18 | CoinGecko `venice-token` |
| xPOD | `0xec29…988` | 18 | not listed — shown as **unpriced** |

CoinGecko's `/coins/base/contract/<address>` endpoint sends no CORS headers, so ids are pinned in
`KNOWN_TOKENS` rather than resolved at runtime. Unknown tokens fall back to RPC `symbol()`/`decimals()`
and are rendered as **unpriced**: visible in the rail list and ledger, excluded from the USD total,
with the count called out under "Total revenue".

Note: xPOD is an ERC-4626 vault. When someone pays with xPOD the contract redeems the shares and
emits `APICreditsPurchased` with `paymentToken = POD`, so such a payment lands on the **POD** rail at
the redeemed amount — it never appears as xPOD.

### Failure behaviour

Blockscout unreachable → last good response from `localStorage` → bundled fixture, with a banner
saying which one is being shown. CoinGecko unreachable → last cached prices, values stay visible and
the card reads `DEGRADED`. The page never goes blank.

## Deploying a change

GitHub Pages caches assets for 10 minutes. `index.html` references `styles.css?v=…` and `app.js?v=…`
— **bump that stamp** whenever you ship a change, so returning visitors can't pair new HTML with a
stale script:

```bash
sed -i 's/?v=[0-9a-z]*/?v=$(date +%Y%m%d%H%M)/g' index.html
git commit -am "bump asset stamp" && git push
```

## Editing

- Colours per rail: `RAIL_COLOR` in `app.js`
- Known symbol/decimals/CoinGecko ids: `KNOWN_TOKENS` (others are auto-resolved)
- Poll interval: the `setInterval(... 60_000)` at the bottom of `app.js`
- `prefers-reduced-motion` renders a static scene instead of the animation.

## Notes

- USD figures use **today's** rate, not the rate at payment time.
- The published site is public even though this repository is private.
