import { NextResponse } from 'next/server'
import { previewChangeReport, startAlertWatcher } from '@/lib/domain/alertWatcher'
import { changeLinkLines, changeTableLines } from '@/lib/domain/poolChanges'

export const dynamic = 'force-dynamic'

/**
 * Renders the change report as it stands, without sending it.
 *
 * Reads the watcher's own baseline, so this shows what a message would say rather than a second
 * opinion computed differently. Nothing is recorded and no baseline advances.
 */
export const GET = async () => {
  startAlertWatcher()

  try {
    const preview = await previewChangeReport()

    return NextResponse.json({
      lines: changeTableLines(preview.rows),
      links: changeLinkLines(preview.rows),
      watched: preview.rows.length,
      material: preview.material,
      minChangePercent: preview.minChangePercent,
      lastReportAt: preview.lastReportAt,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
