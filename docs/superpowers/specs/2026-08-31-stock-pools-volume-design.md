# Stock pools tab, volume history, and spike alerts

Robinhood Chain (4663) carries 47 tokenized equities and ETFs issued by Robinhood. They sit in
214 of the 2,338 pools Krystal reports, hold $26.7M of the chain's TVL and take 13.6% of its 24
hour volume. Those pools spike hard against their own baseline in a way the rest of the chain
does not, and nothing in the tracker currently separates them from the memecoins that make up
the other 91% of the pool list.

This adds three things: a way to identify a stock pool, an hourly volume history read from
Uniswap, and a `/stocks` route that charts that history and feeds a spike rule into the existing
Telegram alerts.

## What the measurements showed

Two claims were tested against seven days of Uniswap transaction data across six stock pools and
four memecoin control pools of comparable volume.

**Spikes are real and large.** Measured as an hour's volume rate over that pool's own trailing
median: WETH/GLD reached 21x, DJT/USDG reached 85x. The memecoin controls stayed near 4x at p95.

**Spikes are not aligned to the US trading session.** Stock pools put 41.0% of weekday volume
inside 09:00-16:00 ET against 52.2% for the memecoin control, where a flat day would give 29.2%.
The control is more session-concentrated than the stocks, and both profiles turn out to be driven
by single outlier hours rather than a daily rhythm. No clock-aligned pattern is claimed anywhere
in this design. The chart marks the session because it is useful orientation for someone holding
a tokenized equity, not because the data explains volume by it.

The distinction matters for the alert: the rule fires on a pool departing from its own recent
behaviour, and never on the time of day.

## Identifying a stock pool

`lib/domain/stockTokens.ts` holds a frozen map of the 47 token contract addresses to their
tickers, and exposes `isStockToken(address)` and `isStockPool(pool)`.

Matching is on address. It cannot be on symbol: `HOOD` resolves to six unrelated contracts on this
chain and none of them is Robinhood stock, and `COIN`, `GME`, `NET`, `MU`, `SNDK` and `AMC` each
exist as both a tokenized equity and a memecoin. Ticker-shaped symbols are the house style here
(`BOWJONES`, `NASDANQ`, `MEMESTOCK`), so a symbol match would be wrong in both directions.

The list was derived once, from Krystal's own logo slugs: an issued equity's logo filename ends in
`robinhood-tokenized-stock` or `robinhood-token`, while `robinhood-pepe` and `turbo-on-robinhood`
do not. Uniswap's transaction feed confirms the same 47 independently, naming them
`SPDR S&P 500 ETF Trust • Robinhood Token` with `project.homepageUrl` on robinhood.com. The
derivation is not shipped. A CDN filename is not a contract, and Krystal never promised to keep
it; the addresses are permanent, so they are what the repo stores. A newly listed ticker is added
by re-running the derivation by hand, which is the right cadence for something that changes a few
times a year.

## Volume history

The one genuinely new subsystem. Nothing in the repo currently keeps a time series.

```
Uniswap ListTransactions
   │  lib/clients/uniswap.ts :: fetchPoolSwaps          data layer, IO only
   ▼
lib/domain/volumeHistory.ts    bucket swaps into aligned hours, evict past 48
   ▼
lib/domain/volumeStore.ts      .volume-history.json
   │
   ├──► app/api/volume/route.ts ──► components/StockVolumeChart.tsx
   └──► lib/domain/volumeSpike.ts ──► alertWatcher ──► clients/telegram.ts
```

`volumeStore` follows `lib/domain/alertStore.ts` exactly: a JSON file, `readJson`/`writeJson` that
swallow their own failures so a read-only disk cannot break the app, and the interpretation split
into a pure function that tests without touching a filesystem.

The store keeps 48 hourly buckets per pool, holding only pools that pass `isStockPool`. At 214
pools that is 10,272 buckets, roughly 700KB at the byte-per-entry rate the existing
`.pool-sightings.json` already runs at (4.8MB across 61,590 entries).

Scoping the store to stock pools is what makes it affordable. Sampling all 2,338 pools hourly
would cost an order of magnitude more requests against a gateway the sweep already has to retry
around. The consequence is stated plainly rather than left implicit: **spike alerts fire for
stock pools only.** Extending them to the rest of the chain means widening the store first, and
that is a separate decision with a real cost attached.

### Backfill, and why its fragility is contained

Uniswap's page token is base64 JSON carrying `{timestampMs, chainId, globalSequenceNumber}`. A
synthetic token with a maximal sequence number seeks the feed to any point in time, which is what
makes a 48 hour backfill affordable: a pool running 100 swaps per three minutes would otherwise
need thousands of sequential pages.

This depends on an undocumented encoding. It is used only by backfill. The live sampler reads the
newest page and buckets forward, needing no seek at all. If Uniswap changes the encoding, backfill
stops, the chart starts empty and fills over the following two days, and no alerting path is
affected.

### Sampling method

A page of 100 swaps gives a volume rate: sum of `amountUsd` over the span between its newest and
oldest swap. This is the estimator to use, not a sum over the whole hour. Summing was tried first
and failed on busy pools, where a page cap meant each bucket described only the last few minutes
of its hour and the reading was biased by where in the hour it landed.

A page whose span exceeds an hour cannot say which hour its volume belonged to. Quiet pools
routinely return pages spanning several hours, so a bucket built from one is recorded with its
span and is not treated as an hourly reading.

## Spike rule

`lib/domain/volumeSpike.ts`, a pure function over a pool's buckets.

```
spike when   rate / median(trailing 24 buckets) >= spikeMultiple
       and   rate >= spikeMinVolumeUsd
       and   the pool has at least 12 buckets of history
       and   the pool has not alerted within the cooldown
```

The baseline is a median, not a mean, because a mean is dragged upward by the very spike being
detected.

**Defaults: `spikeMultiple` 5, `spikeMinVolumeUsd` 100,000 per hour, cooldown 2 hours.** These
come from replaying the rule over the seven day sample and counting what it would have sent, not
from where the stock and control distributions separate. At 5x with a $100k/h floor every pool
tested lands between 0.9 and 2.4 alerts per day.

The floor is doing specific work and should not be removed as arbitrary. Without it the thin pools
fire three to four times a day, because these pools are new and growing fast enough that ordinary
growth clears a trailing median. WETH/GLD's median hourly volume over seven days is $795 against
$63,419 over the most recent two, which is the shape of a pool that grew rather than a pool that
spiked.

## Alerts

Three fields on `AlertFilters` in `lib/domain/newPools.ts`: `spikeEnabled`, `spikeMultiple`,
`spikeMinVolumeUsd`. A `reportSpikes` call in `pollOnce` beside the existing `reportChanges`, and
a message composer alongside the current ones.

This inherits the existing `enabled` flag, the `mentions` list and `monitoredPoolIds` rather than
introducing a parallel notion of what is being watched. Spike alerts respect `monitoredPoolIds`
when it is non-empty, so the pools worth watching stay a decision rather than a query, matching
how change reports already behave. Where that list is empty, spikes fire across every stock pool
in the store, which is the scope named above.

## The /stocks route

`app/stocks/page.tsx` streams `StocksSection` behind Suspense, matching the structure of
`app/page.tsx`. It reuses `getPoolsSnapshot` filtered through `isStockPool`, so the page costs no
additional pool fetch. `components/Navbar.tsx` gains a fourth link.

`components/StockVolumeChart.tsx` renders aggregate hourly volume across stock pools, with the US
cash session marked. Selecting a table row overlays that pool's own series. The chart reads
`/api/volume`, which is a thin handler delegating to the domain layer and mapping typed errors,
carrying no logic of its own.

## Testing

Written failing first.

| File | Covers |
| --- | --- |
| `lib/domain/stockTokens.test.ts` | `HOOD`, `COIN`, `GME`, `MU`, `SNDK`, `AMC` resolve by address; the memecoin contracts are rejected and the issued ones accepted |
| `lib/domain/volumeHistory.test.ts` | Hour alignment, rolling eviction at 48, median across buckets with gaps, a page spanning over an hour excluded from hourly readings |
| `lib/domain/volumeSpike.test.ts` | Multiple, floor, cooldown, insufficient history, and that a mean-based baseline would have fired where the median does not |
| `app/api/volume/route.test.ts` | Handler delegates to the domain layer and maps typed errors, domain mocked |

Domain tests mock the data layer. The route test mocks the domain layer and asserts delegation
plus error mapping, and does not re-test domain internals through the handler.

## Deliberately not included

Auto-refreshing the stock token list from Krystal on every sweep. The list changes when Robinhood
issues a new ticker, which is far rarer than a deploy, and a heuristic over CDN filenames running
unattended in production is a worse failure mode than a stale list.

Backfill beyond 48 hours. The chart shows two days and the spike baseline needs 24 buckets;
storing a week would cost more than either uses.
