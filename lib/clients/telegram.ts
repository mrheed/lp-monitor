/** Whether a bot is configured. Checked before offering alerts, so the UI can explain the gap. */
export const telegramConfigured = () =>
  Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID)

/**
 * Sends or edits the single message each alert keeps.
 *
 * The token and chat id are read from the environment and never leave the server. Sending is
 * deliberately not retried: a repeated alert is worse than a missed one, since the pool it
 * describes will still be in the table.
 */
/** Calls one Telegram method, returning the parsed result or throwing with its own reason. */
const call = async (method: string, body: Record<string, unknown>) => {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID

  if (!token || !chatId) throw new Error('Telegram is not configured')

  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      // Composed as HTML so links can sit behind short labels. Everything drawn from chain data
      // is escaped by the composer before it gets here.
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...body,
    }),
    cache: 'no-store',
  })

  if (!response.ok) {
    // The body carries Telegram's own reason, which is what makes a misconfiguration fixable,
    // and on a 429 it carries how long to wait. Discarding that turns a solvable rate limit into
    // a retry loop that keeps earning the same rejection.
    const body: unknown = await response.json().catch(() => null)
    const detail = describe(body) ?? `HTTP ${response.status}`

    throw new TelegramError(`Telegram ${method} failed: ${response.status} ${detail}`, retryAfter(body))
  }

  const parsed: unknown = await response.json().catch(() => null)
  const result = (parsed as { result?: { message_id?: unknown } } | null)?.result

  return typeof result?.message_id === 'number' ? result.message_id : null
}

/** A failed send, carrying Telegram's own requested wait when it gave one. */
export class TelegramError extends Error {
  constructor(
    message: string,
    readonly retryAfterSeconds: number | null,
  ) {
    super(message)
    this.name = 'TelegramError'
  }
}

/** Sends a new message and returns its id, so the next one can delete it. */
export const sendTelegramMessage = async (text: string): Promise<number | null> =>
  call('sendMessage', { text })

/**
 * Removes a message the bot sent.
 *
 * Telegram only permits this for the bot's own messages, and only within 48 hours. A failure is
 * not worth reporting: the worst case is one stale message left in the chat.
 */
export const deleteTelegramMessage = async (messageId: number): Promise<void> => {
  try {
    await call('deleteMessage', { message_id: messageId })
  } catch {
    // Too old, already gone, or removed by hand. Nothing to recover.
  }
}

/** Reads `parameters.retry_after` from an error body, in seconds. */
const retryAfter = (body: unknown): number | null => {
  if (typeof body !== 'object' || body === null) return null

  const parameters = (body as { parameters?: unknown }).parameters
  if (typeof parameters !== 'object' || parameters === null) return null

  const seconds = (parameters as { retry_after?: unknown }).retry_after
  return typeof seconds === 'number' && Number.isFinite(seconds) ? seconds : null
}

/** Reads Telegram's human readable reason from an error body. */
const describe = (body: unknown): string | null => {
  if (typeof body !== 'object' || body === null) return null

  const description = (body as { description?: unknown }).description
  return typeof description === 'string' ? description : null
}
