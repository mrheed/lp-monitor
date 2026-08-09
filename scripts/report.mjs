#!/usr/bin/env node
/**
 * Prints the change report for the watched pools, as the alert would say it.
 *
 * Reads it from the running server rather than recomputing it here, so the terminal and the
 * message are the same comparison against the same baseline. Nothing is sent and no baseline
 * advances, so this is safe to run as often as you like.
 *
 *   npm run report            once
 *   npm run report -- --watch every 60s
 */
const PORT = process.env.PORT ?? '3003'
const BASE = process.env.TRACKER_URL ?? `http://localhost:${PORT}`
const watch = process.argv.includes('--watch')

const dim = (text) => `[2m${text}[0m`
const bold = (text) => `[1m${text}[0m`

const render = async () => {
  const response = await fetch(`${BASE}/api/alerts/report`)
  const body = await response.json().catch(() => null)

  if (!response.ok || body === null) {
    throw new Error(body?.error ?? `HTTP ${response.status}`)
  }

  if (body.watched === 0) {
    console.log(dim('No pools watched. Tick the Watch column in the table to follow one.'))
    return
  }

  const [header, ...rows] = body.lines
  const links = body.links ?? []
  const when = body.lastReportAt ? new Date(body.lastReportAt).toLocaleTimeString() : 'never'

  console.log()
  console.log(bold(`${body.watched} watched pool${body.watched === 1 ? '' : 's'}`))
  console.log(dim(`compared against the last report at ${when}`))
  console.log()
  console.log(dim(header))
  for (const row of rows) console.log(row)
  console.log()

  for (const link of links) {
    console.log(`${dim(link.label.padEnd(22))}${link.url}`)
  }
  if (links.length > 0) console.log()
  console.log(
    body.material
      ? `Past the ${body.minChangePercent}% threshold: an alert would be sent.`
      : dim(`Nothing past the ${body.minChangePercent}% threshold, so no alert would be sent.`),
  )
  console.log()
}

try {
  await render()

  if (watch) {
    console.log(dim('Watching. Ctrl-C to stop.'))
    setInterval(() => {
      render().catch((error) => console.error(`  ${error.message}`))
    }, 60_000)
  }
} catch (error) {
  console.error(`Could not read the report: ${error.message}`)
  console.error(`Is the tracker running at ${BASE}? Start it with: npm run dev`)
  process.exit(1)
}
