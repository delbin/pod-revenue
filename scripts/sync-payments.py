#!/usr/bin/env python3
"""Append new APICreditsPurchased events to payments.json straight from the chain.

Scope: this only ever queries logs emitted by ONE contract --
    eth_getLogs{ address: [ENDPOINT], topics: [[APICreditsPurchased]], fromBlock, toBlock }
Nothing else on the chain is read. Public RPCs cap a single eth_getLogs range at ~1000
blocks, so the *unscanned gap since the last run* is walked in 1000-block steps. At a
5-minute cadence that is 1 request (~150 blocks); after a long outage it grows to whatever
the gap is, and any chunk that cannot be fetched fails the run instead of being skipped.

Runs in GitHub Actions on a schedule. Blockscout's address index lags badly for this
contract, so the chain is the source of truth.

Only writes when a new payment is found, so the repo stays quiet; scannedTo advances only
on a real write, which keeps the next scan window honest (it re-covers anything not yet
committed).
"""
import json
import random
import sys
import time
import urllib.request

ENDPOINT = "0x0009b5e129cbc8d731ba23d99e876faf517c257d"
TOPIC = "0x93ece0a7f4cba426dcb3c786e68fb5fd9ce335d154c103376e160ab0dd00379f"
FILE = "payments.json"
HEAD_RPC = "https://mainnet.base.org"
LOG_RPCS = [
    "https://base.gateway.tenderly.co",
    "https://8453.rpc.thirdweb.com",
]
CHUNK = 1000
UA = {"User-Agent": "pod-gate-sync/1.0", "Content-Type": "application/json"}


def rpc(url, method, params, timeout=30):
    req = urllib.request.Request(
        url,
        data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode(),
        headers=UA,
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def get_logs(start, end):
    """Fetch logs in one chunk, trying each provider in turn."""
    payload = [{"address": ENDPOINT, "fromBlock": hex(start), "toBlock": hex(end), "topics": [TOPIC]}]
    for attempt in range(6):
        url = LOG_RPCS[attempt % len(LOG_RPCS)]
        try:
            d = rpc(url, "eth_getLogs", payload)
            if "error" in d:
                raise RuntimeError(str(d["error"])[:60])
            return d["result"]
        except Exception as exc:  # noqa: BLE001 - any transport/rate error is retryable
            print(f"  retry {attempt + 1} chunk {start}-{end}: {exc}", flush=True)
            time.sleep(1.5 + attempt * 1.5 + random.random())
    raise SystemExit(f"could not fetch logs for {start}-{end}")


def main():
    with open(FILE, encoding="utf-8") as fh:
        state = json.load(fh)

    payments = state.get("payments", [])
    known = {str(p["hash"]).lower() for p in payments}
    if "scannedTo" not in state:
        raise SystemExit("payments.json has no scannedTo checkpoint; refusing to guess a start block")
    start = int(state["scannedTo"]) + 1
    head = int(rpc(HEAD_RPC, "eth_blockNumber", [])["result"], 16)

    if head < start:
        print(f"already at head ({head})")
        return

    print(f"contract {ENDPOINT}  topic APICreditsPurchased  only")
    print(f"scanning {start}..{head} ({(head - start) // CHUNK + 1} chunks of {CHUNK} blocks)")
    if head - start > 500_000:
        print(f"WARNING: {head - start} blocks behind — that is more than a normal 5-minute gap")
    found = []
    cursor = start
    while cursor <= head:
        end = min(cursor + CHUNK - 1, head)
        found.extend(get_logs(cursor, end))
        cursor = end + 1

    fresh = []
    for log in found:
        key = log["transactionHash"].lower()
        if key in known:
            continue
        known.add(key)
        topics = log["topics"]
        fresh.append(
            {
                "hash": log["transactionHash"],
                "block": int(log["blockNumber"], 16),
                "payer": "0x" + topics[1][-40:],
                "tokenAddress": ("0x" + topics[2][-40:]).lower(),
                "rawAmount": str(int(log["data"], 16)),
            }
        )

    if not fresh:
        print("no new payments; leaving checkpoint unchanged")
        return

    for p in fresh:
        for attempt in range(4):
            try:
                blk = rpc(HEAD_RPC, "eth_getBlockByNumber", [hex(p["block"]), False])
                p["ts"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(int(blk["timestamp"], 16)))
                break
            except Exception:  # noqa: BLE001
                time.sleep(1 + attempt)

    payments.extend(fresh)
    payments.sort(key=lambda p: p["block"], reverse=True)
    state["payments"] = payments
    state["scannedTo"] = head
    state["generatedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    with open(FILE, "w", encoding="utf-8") as fh:
        json.dump(state, fh, indent=2)
        fh.write("\n")

    print(f"added {len(fresh)} payment(s); checkpoint now {head}")
    for p in fresh:
        print("  +", p.get("ts"), p["block"], p["tokenAddress"], p["rawAmount"], p["hash"])


if __name__ == "__main__":
    main()
