# LP Pool Tracker

Scores Uniswap liquidity pools on Robinhood Chain (EVM chain 4663) by recent fee rate, thin
TVL, trade rate and trader count, and marks which pools your wallets hold or have held,
directly or through a vault.

## Running it

```bash
npm install
cp .env.example .env.local   # add your wallet addresses
npm run dev                  # http://localhost:3003
```

`LP_WALLETS` takes a comma separated list of addresses. Each may carry a label after an equals
sign, `0xabc…=Main`, which is the name the position column shows; without one the address is
shortened to `0xabc…1234`. Labels matter once you track several wallets, since the column names
which of them holds each pool and truncated hex is not readable at a glance. With a single
wallet the name is omitted, because it would be identical on every row that has one.

Without `LP_WALLETS` the table still renders and the position column reports that no wallets are
configured.

```bash
npm test        # unit tests, no network
npm run test:live   # end to end check against the live APIs
npm run typecheck
```

## What it shows

| Column | Source |
|---|---|
| Score | Composite of the four factors below, 0 to 100 |
| Fee rate | Krystal, shortest window that reported fees, as an hourly rate |
| Fees total, TVL | Krystal `lp_explorer/top_pools`, TVL preferring Uniswap `ListPools` |
| Transaction rate, volume rate, traders | Uniswap `ListTransactions`, background sweep |
| My share, my fees, my APR | Simulated from the deposit in the toolbar |
| Volatility, drawdown | Krystal, already expressed as percentages |
| Age | Lower bound from how far back the cumulative volume windows extend |
| Position | Krystal `strategies/profile` plus per-vault `strategies[]` |
| Links | Krystal pool detail, Uniswap explore |

Position reads `In` for a pool you currently hold and `Past` for one you have closed, with
`vault` when the exposure runs through a vault rather than a direct position. When several
wallets are tracked it also names them, striking through the ones that have closed out. A pool
counts as held if any tracked wallet still holds it. Hover the chip for each wallet's own state
and full address, or the score for its five components.

## Why the ranking runs in two stages

The score needs trade rate and trader counts, but those cost one request per pool, which would
make the ranking depend on itself. A first pass scores every pool on fee rate and TVL alone,
the only factors known for all 2,600, and picks which are worth measuring. The second pass
scores the measured ones on all four. Unmeasured pools rank below, since they cannot be
compared on rate or traders.

## Responsive behaviour

The table is a wide-viewport view, not the only view. Below `md` it is replaced by cards rather
than squeezed: eighteen columns scrolled sideways with nothing anchoring the row is not a table
anyone can read. A card keeps the same information in the same priority order, stacked.

From `md` up, each column declares the width at which it earns its place. Identity and the
figures a decision turns on are always present; supporting detail appears as the viewport
allows, so the table fits without horizontal scrolling at each step.

| Width | Columns |
|---|---|
| under `md` | cards, no table |
| `md` | 9 |
| `lg` | 13 |
| `xl` | 16 |
| `2xl` | all 18, plus the column-family header |

The family header row appears only at `2xl`, because `colSpan` is a fixed attribute and cannot
follow a column hidden by CSS; showing it earlier would misalign the labels from their columns.

Controls carry a taller hit area below `sm`, and the watch checkboxes sit inside a 36 to 44px
target, since a checkbox sized for a pointer is not tappable.

## Loading

Rendering and measuring are separate. The table renders ten rows at a time and adds more as you
scroll; independently, a background sweep measures a fixed prefix of the rank order in parallel
batches until that cohort is complete. Pool data refreshes every sixty seconds and measurements
already fetched survive the refresh.

Sweep speed is governed by payload size, not by the server. A 100 transaction page is 465KB and
sustains 1.5 requests per second; a 25 transaction page is 116KB and sustains 6. Since the
sample only has to span enough time to derive a rate, the tracker requests 25 and the whole set
takes about seven minutes instead of half an hour.

Concurrency has a measured optimum of about 24: 12 concurrent gives 5.2 requests per second, 24
gives 6.1, and 48 drops back to 5.1 as the endpoint over saturates. No rate limiting appeared at
any level. The one cost of the smaller page is that unique trader counts cannot exceed 25.

That bound matters for correctness, not just speed. A score is a position within the measured
cohort, so measuring only what happened to be on screen ranked each pool against an arbitrary
handful of others and changed the answer as you scrolled. Measuring a fixed prefix of the rank
order instead means the cohort is the same every session. Pools outside it are listed but not
scored, rather than being scored against a different set.

## Scoring

Pools are ranked by a composite 0 to 100 score over five factors, each pointing the way you
would expect: more fees is better, **less** TVL is better, a faster trade rate is better, more
distinct traders is better, and **lower** volatility is better.

Volatility carries the second largest weight because price movement drives impermanent loss,
which works directly against the fee income the other factors reward. Trader count carries the
least, since it is capped by the 25 transaction sample it comes from and discriminates less
than an equal share would suggest.

The fee factor reads the **recent** fee rate, taken from the shortest window that reported any
fees and normalised to an hourly figure, not the accumulated total. A pool that earned heavily
last week and nothing since should not outrank one earning now. Accumulated fees are still
shown, in their own column, purely for context. Weights live in `lib/domain/score.ts` and
default to fees 0.30, calmness 0.25, thinness 0.20, rate 0.15, traders 0.10.

Fee rate, TVL and trade rate are normalised by magnitude: each is log scaled, then clipped at
the 1st and 99th percentiles of the cohort and mapped onto 0..1. Percentile rank was tried first
and discarded, because it is invariant to magnitude. With a fee rate whose median is $37/h and
90th percentile is $403/h, pools at $4,315/h and $253/h both land in the thin upper tail, so a
seventeen fold advantage collapsed into a fraction of a percentile and lost to a 21 trader
difference in a much denser distribution.

Trader count and volatility keep percentile rank. Both are bounded, so neither has a magnitude
range worth preserving: volatility is a percentage spread fairly evenly from 0 to 100, where log
scaling would wrongly compress the calm end. A volatility of exactly 0 is treated as genuine,
since only 2 of 2,642 pools report it and both have real volume with no drawdown.

Log scaling also bounds the TVL inversion. A raw fees/TVL ratio gives a near empty pool an
unbounded lead; a bounded 0..1 score means a dust pool wins the thinness factor and still loses
on the other three.

## New-pool alerts

The toolbar can announce pools that appear while the page is open, to a Telegram chat, filtered
by minimum fee and by whether the pool has a hook. Handles listed under Mention lead the message
so the people named are actually notified rather than the alert merely arriving.

Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` in `.env.local`. Create the bot with
[@BotFather](https://t.me/BotFather), put the token in place, then:

```bash
npm run telegram:chat-id
```

Telegram has no lookup by name: a bot only learns a chat id once it has received a message from
that chat. Send the bot a direct message, or add it to a group and send `/start@yourbotname`
there, then run the script and it prints the ids with the line to copy. Bots ignore ordinary
group messages unless privacy mode is disabled via @BotFather, which is why the group case needs
an explicit mention. Both are read only on the
server; the browser decides which pools are new and sends that list to `/api/alerts`, which owns
the credentials. Without them the controls stay disabled and say so.

Alerts are off by default and stay off until switched on, so configuring a bot never starts
sending on its own. The pools already listed when the page loads are treated as known, so
enabling alerts announces what appears next rather than all 2,600 at once. A burst becomes one
message naming the first eight pools and counting the rest, because a chain that mints pools
continuously would otherwise get the bot rate limited.

## Deposit simulation

The toolbar takes a deposit amount and the table projects what it would earn in each pool:
the share of the pool it would represent, the fees per day, and the annualised return.

The deposit is added to the denominator. Putting $1,000 into a pool holding $2,000 buys a third
of it, not a half, because the deposit enlarges the pool. Dividing by the pre-deposit TVL is the
common mistake and it flatters thin pools worst, which are exactly the ones a thinness-weighted
score pushes to the top.

This is the honest counterweight to that bias. USDG/RUBY holds $5,522 and shows a headline
586,049% APR; a $10,000 deposit takes 64% of the pool and cuts it to 208,482%. Meanwhile
RDDT/USDG at $91,882 barely moves, 83,088% down to 82,194%, because the same deposit is 1.1% of
it. Deeper pools preserve the return at a given deposit size.

**The annualised figures are arithmetic, not forecasts.** An APR derived from a one hour fee
window assumes that hour repeats for a year, which is why the numbers run to six figures on a
chain of day old memecoin pools. Read them as a ranking device, not an expected return. The
simulation also ignores impermanent loss and assumes the position earns across the whole range;
a concentrated position earns more inside its range and nothing outside it.

### Two caveats on the top of the list

- **Thin pools rank high by design, and thin means thin.** The current leaders sit around
  $6,000 TVL. A deposit of any size becomes most of the pool and collapses the yield that ranked
  it. Use the TVL filter for anything you intend to actually size into.
- **Trader counts saturate.** They come from a 25 transaction sample, so a pool cannot show more
  than 25 distinct traders and busy pools bunch at the ceiling. That is the deliberate cost of
  the smaller page that made the sweep four times faster.
- **Age is activity span, not creation.** Neither feed exposes a creation time and the
  transaction API ignores every ordering parameter, so a pool created a month ago that only
  began trading today reads as young. It is also a lower bound: the windows only say which of
  them contain activity, so the widest one that grew sets the floor. 30 days is the widest
  figure available, which is why nothing ever reads older than `1w`.

`lib/domain/rank.ts` holds the earlier fee-band ordering, still used for pools that never got
measured.

## Transaction rate

Rate comes from the span a single page of transactions covers, not a fixed lookback:
`pageSize / (newest - oldest)`. A busy pool and a dead pool therefore cost one request each. A
page spanning no time yields 0 rather than dividing by zero.

Sixty pools are measured before the page is served so the first screen is populated; the
background sweep covers the rest.

## Upstream quirks worth knowing

These are all verified against the live APIs, and each one fails silently rather than loudly.

- **Krystal ignores several query params.** `protocol=uniswapv4` and `dynamicFee=1` are both
  accepted and discarded; the feed returns mixed v3 and v4 pools regardless. `lib/clients/uniswap.ts`
  derives the protocol version per pool instead of trusting the request.
- **Uniswap ignores `poolIds`.** Passing an array, or a comma joined `poolId`, returns HTTP 200
  with a full page of chain wide transactions spanning other pools. Responses are filtered back
  down to the requested pool id on the way out.
- **`page.pageSize` caps at 100.** 101 and above returns HTTP 400.
- **`poolAddress` on a v4 position is the PoolManager singleton.** Uniswap v4 keeps every pool
  in one contract and identifies pools by a 32 byte id, so `poolAddress` is the same value for
  every v4 pool on the chain. Joining on it matches nothing, or worse, matches everything. The
  real key is `pool.id`, and the `strategies/profile` feed does not carry one at all, so direct
  v4 positions fall back to a token pair match. 42 of 1,939 v4 pairs map to more than one pool,
  one of them to sixteen; those resolve to nothing rather than marking every candidate.
- **A vault's `pools[]` is not what it holds.** It lists every pool the vault has touched and
  carries no status. Per position status lives in `strategies[]`, where a live vault routinely
  shows five closed positions beside one open one. Reading `pools[]` marks them all as open.
- **`feeTier` is already a percentage.** It is not the on chain hundredths of bips convention,
  so dividing by 10,000 renders every pool as 0.00%. `feeTier` equals `lpFee + protocolFee`, and
  the v2 pools all report exactly 0.3, matching that protocol's fixed 0.30% fee.
- **`priceVolatility` and `drawdown24h` are percentages too**, not fractions.
- **Neither feed exposes a pool creation time**, and the transaction API ignores every ordering
  parameter tried (`sortOrder`, `orderBy`, `ascending`), returning byte identical responses. Age
  is therefore estimated from how far back the cumulative volume windows extend.
- **`pool_detail` ignores `includeTicks`.** It returns 1.1KB with no tick array. It does carry
  token balances and USD prices, which `top_pools` leaves blank.
- **The dashboard is a single page app.** Every path returns 200, including nonsense ones, so
  status codes prove nothing about a URL format. The link template came from the app bundle.

## Layout

```
app/api/pools/route.ts     transport: the ranked snapshot, polled every five seconds
app/api/activity/route.ts  transport: activity for one batch of scrolled-to pools
app/page.tsx             server component
components/PoolTable.tsx client: sort, filter, checklist
lib/domain/              logic: ranking, activity, position join, orchestration
lib/clients/             data: Krystal and Uniswap HTTP access
```

Each source degrades on its own. A failure fetching activity or positions blanks that column
and records a warning; it does not fail the page.
