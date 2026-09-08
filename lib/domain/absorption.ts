/**
 * The absorption signals from Mage's runner-detection note, in the subset OHLCV can support.
 *
 * The note's full framework also reads wallet quality, smart-money persistence and buy/sell
 * imbalance. None of those are in a candle, so they are absent here rather than approximated:
 * a proxy would make the backtest measure the proxy instead of the idea.
 *
 * What a candle does support is the note's central claim, which is also its most testable one:
 * that price movement per unit of volume says more than price movement alone.
 */
export type Candle = {
  timeMs: number
  open: number
  high: number
  low: number
  close: number
  /** Traded value in USD over the candle. */
  volumeUsd: number
}

/** Every signal read at one point in time, each in its own units. */
export type Signals = {
  /**
   * Price move per million dollars traded, over the window. The note's "downside efficiency"
   * and "price response" inverted into one number: low means the market absorbs flow without
   * moving, which is the condition the note calls interesting.
   */
  priceResponse: number
  /** Absorption: elevated volume with little net price movement. Higher is more absorbed. */
  absorption: number
  /** Volume in the recent half of the window against the older half. Above 1 is expanding. */
  volumeExpansion: number
  /** Candle range as a share of price, averaged. Falling range is the note's compression. */
  volatility: number
  /** Fraction of candles that broke below the window's support and closed back above it. */
  failedBreakdowns: number
  /** Whether the window's lows are rising, which the note uses for its structural stop. */
  higherLows: boolean
  /** Net price change across the window, as a fraction. */
  priceChange: number
}

const mean = (values: number[]) => (values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length)

/**
 * Reads every signal from one window of candles.
 *
 * Uses only the candles given, so a caller walking forward can never leak the future into a
 * measurement: the window is the past, and the outcome is measured from candles this never sees.
 */
export const readSignals = (window: Candle[]): Signals | null => {
  if (window.length < 6) return null

  const first = window[0]
  const last = window[window.length - 1]
  if (!(first.open > 0) || !(last.close > 0)) return null

  const priceChange = (last.close - first.open) / first.open
  const totalVolume = window.reduce((sum, c) => sum + c.volumeUsd, 0)
  if (!(totalVolume > 0)) return null

  // Price move per $1M traded. The note's example: $100k selling for -25% is fragile, the same
  // $100k for -4% is absorption.
  const priceResponse = (Math.abs(priceChange) * 100) / (totalVolume / 1_000_000)

  const half = Math.floor(window.length / 2)
  const older = window.slice(0, half)
  const recent = window.slice(half)
  const olderVolume = mean(older.map((c) => c.volumeUsd))
  const recentVolume = mean(recent.map((c) => c.volumeUsd))
  const volumeExpansion = olderVolume > 0 ? recentVolume / olderVolume : 1

  // Absorption: volume expanding while price refuses to fall. Expressed so that a pool taking
  // more flow for less movement scores higher.
  const absorption = volumeExpansion / (1 + Math.abs(priceChange) * 10)

  const volatility = mean(window.map((c) => (c.high - c.low) / Math.max(c.close, 1e-12)))

  // Support is the lowest low of the window's first half; a failed breakdown is a candle that
  // pierced it and closed back above.
  const support = Math.min(...older.map((c) => c.low))
  const pierced = recent.filter((c) => c.low < support)
  const reclaimed = pierced.filter((c) => c.close > support)
  const failedBreakdowns = recent.length > 0 ? reclaimed.length / recent.length : 0

  const lows = window.map((c) => c.low)
  const firstHalfLow = Math.min(...lows.slice(0, half))
  const secondHalfLow = Math.min(...lows.slice(half))
  const higherLows = secondHalfLow > firstHalfLow

  return {
    priceResponse,
    absorption,
    volumeExpansion,
    volatility,
    failedBreakdowns,
    higherLows,
    priceChange,
  }
}

/**
 * The note's continuation score, as a weighted blend of what candles can see.
 *
 * Weights follow the note's own ranking rather than a fit: absorption and downside efficiency
 * are its five-star signals, failed-breakdown reclaim likewise, and structure carries less.
 * Fitting weights to the same data the score is then tested on would measure the fit, not the
 * idea, so these stay as the note states them.
 */
export const continuationScore = (signals: Signals): number => {
  // Each component is squashed into 0..1 so no single raw magnitude dominates the sum.
  const absorbed = signals.absorption / (1 + signals.absorption)
  // Low price response is good, so it is inverted.
  const efficient = 1 / (1 + signals.priceResponse)
  const expanding = signals.volumeExpansion / (1 + signals.volumeExpansion)
  const compressed = 1 / (1 + signals.volatility * 20)

  return (
    0.3 * absorbed +
    0.25 * efficient +
    0.15 * expanding +
    0.15 * signals.failedBreakdowns +
    0.1 * (signals.higherLows ? 1 : 0) +
    0.05 * compressed
  )
}
