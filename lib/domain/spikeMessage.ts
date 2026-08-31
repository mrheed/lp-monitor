import type { Spike } from './volumeSpike'

/** Escapes the four characters Telegram's HTML mode treats as markup. */
const escape = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * The hour a spike landed in, in US Eastern where the underlying equities trade.
 *
 * Printed because a spike is not necessarily current: a pool whose sampling has stalled alerts on
 * the newest hour it has, which can be hours behind the message.
 */
const easternHour = (ms: number) =>
  new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(ms))

/** Rate as a short label: thousands below a million, millions above. */
const rate = (value: number) =>
  value >= 1_000_000 ? `$${(value / 1_000_000).toFixed(1)}M/h` : `$${Math.round(value / 1000)}k/h`

/**
 * One message covering every spike in this pass.
 *
 * Batched rather than one message per pool: several stock pools commonly move together, and a
 * burst of separate messages is the fastest way to have the alerts muted.
 */
export const composeSpikeMessage = (
  spikes: Spike[],
  labels: Record<string, string>,
  mentions: string[],
): string => {
  const lines = spikes.map((spike) => {
    const label = labels[spike.poolId.toLowerCase()] ?? spike.poolId
    return (
      `• <b>${escape(label)}</b> ${spike.multiple.toFixed(1)}x · ${rate(spike.rateUsdPerHour)} ` +
      `against ${rate(spike.baselineUsdPerHour)} baseline · hour to ${easternHour(spike.atMs)} ET`
    )
  })

  const mentionLine = mentions.length > 0 ? `\n${mentions.map((name) => `@${name}`).join(' ')}` : ''

  return `<b>Volume spike</b>\n${lines.join('\n')}${mentionLine}`
}
