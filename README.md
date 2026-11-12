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

## How it works — and why the chain, not an indexer

**Blockscout's address index lags badly for this contract** (it stopped listing new
transactions around 1 Nov while the chain kept receiving payments). An earlier build read
`APICreditsPurchased` from Blockscout and silently under-reported. That is fixed:

| Data | Source | Refresh |
|---|---|---|
| Payments | `payments.json` — scanned directly from Base logs | every 15 min (workflow) |
| USD prices | CoinGecko `simple/price` | every 60s in-browser |
| Confirmations | public Base RPC (`eth_blockNumber`, receipts) | every 60s in-browser |
| Indexer rows | Blockscout `/logs` (merged in, may lag or be ahead) | every 60s in-browser |

`payments.json` is the authoritative checkpoint: `{ scannedTo, payments: [{ hash, block, ts,
payer, tokenAddress, rawAmount }] }`. The page loads it, merges Blockscout's rows (deduped by
hash), and sorts by block — so a lagging indexer can never hide a payment.

### Keeping it current

`.github/workflows/sync-payments.yml` runs `scripts/sync-payments.py` every 15 minutes. It
scans from `scannedTo + 1` to head in 1000-block chunks (public RPCs cap `eth_getLogs` at
1000 blocks), appends any new `APICreditsPurchased` events with their block timestamps, and
commits only when something new landed. Pages then rebuilds.

To refresh manually: **Actions → Sync payments → Run workflow**, or locally:

```bash
python3 scripts/sync-payments.py
git commit -am "sync" && git push
```

### Coverage note

History up to block `53366534` (1 Nov) comes from Blockscout, captured while its index was
still current and complete; everything after is a direct chain scan. If you ever need to
re-derive the early history, scan `eth_getLogs` from the deployment block `47141764`.

### Supported rails

All six assets whitelisted on the endpoint render as their own rail:

| Rail | Token contract | Decimals | Price source |
|---|---|---|---|
| POD | `0xed66…f8f` | 18 | CoinGecko `dolphin-2` |
| ETH | native (`address(0)`) | 18 | CoinGecko `ethereum` |
| USDC | `0x8335…913` | 6 | CoinGecko `usd-coin` |
| USDT | `0xfde4…bb2` | 6 | CoinGecko `l2-standard-bridged-usdt-base` |
| VVV | `0xacfe…1bf` | 18 | CoinGecko `venice-token` |
| xPOD | `0xec29…988` | 18 | valued at the **POD rate** (`KNOWN_TOKENS` → `valuedAs: 'POD'`), labelled "as POD" |

CoinGecko's `/coins/base/contract/<address>` endpoint sends no CORS headers, so ids are pinned in
`KNOWN_TOKENS` rather than resolved at runtime. xPOD has no listing, so it is valued 1:1 with POD
(`valuedAs: 'POD'`); every place it appears says "as POD". Swap that for `cgId` once it's listed, or
for the vault's `convertToAssets` rate (~1.00022 POD/share) if you want mark-to-vault. Unknown tokens fall back to RPC `symbol()`/`decimals()`
and are rendered as **unpriced**: visible in the rail list and ledger, excluded from the USD total,
with the count called out under "Total revenue".

Note: xPOD is an ERC-4626 vault. When someone pays with xPOD the contract redeems the shares and
emits `APICreditsPurchased` with `paymentToken = POD`, so such a payment lands on the **POD** rail at
the redeemed amount — it never appears as xPOD.

### Two USD figures

Every amount shows **today's value** first, then the **value at the time of payment** in parentheses
behind an ⓘ (hover or keyboard-focus shows "value at time of payment"):

```
$4.74 ($5.06 ⓘ)
```

- Current: amount × latest CoinGecko price (refreshed every 60s).
- At payment: amount × the CoinGecko sample nearest that block
  (`/coins/{id}/market_chart/range`, ±30 min window; hourly granularity here). Successful lookups are
  cached permanently in `localStorage` — the past doesn't change.
- The headline total carries both, and only shows the historical figure when every priced payment has one.

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
