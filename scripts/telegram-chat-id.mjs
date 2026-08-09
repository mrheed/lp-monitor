#!/usr/bin/env node
/**
 * Prints the chat ids a bot can currently see, so `TELEGRAM_CHAT_ID` can be filled in.
 *
 * Telegram has no lookup by name: a bot only learns a chat id once it has received an update
 * from that chat. So this reads the pending updates and reports whatever is in them, and says
 * what to do when there are none, which is the usual case on a first run.
 */
import { readFileSync } from 'node:fs'

/** Reads a key from the env, falling back to the project's env files. */
const readToken = () => {
  if (process.env.TELEGRAM_BOT_TOKEN) return process.env.TELEGRAM_BOT_TOKEN

  for (const file of ['.env.local', '.env']) {
    try {
      const match = readFileSync(file, 'utf8').match(/^TELEGRAM_BOT_TOKEN=(.*)$/m)
      const token = match?.[1].trim()
      if (token) return token
    } catch {
      // File absent or unreadable; try the next one.
    }
  }

  return null
}

const token = readToken()

if (!token) {
  console.error('No TELEGRAM_BOT_TOKEN found in the environment, .env.local or .env.')
  console.error('Create a bot with @BotFather, then put its token in .env.local.')
  process.exit(1)
}

const call = async (method) => {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`)
  const body = await response.json().catch(() => null)

  if (!body?.ok) {
    const detail = body?.description ?? `HTTP ${response.status}`
    throw new Error(detail)
  }

  return body.result
}

try {
  const me = await call('getMe')
  console.log(`Bot: @${me.username}`)

  // A webhook consumes updates before getUpdates can see them, which otherwise looks exactly
  // like "nobody has messaged the bot" and is the most confusing way for this to fail.
  const webhook = await call('getWebhookInfo')
  if (webhook.url) {
    console.error(`\nA webhook is set (${webhook.url}), so getUpdates returns nothing.`)
    console.error(`Remove it: curl "https://api.telegram.org/bot<TOKEN>/deleteWebhook"`)
    process.exit(1)
  }

  const updates = await call('getUpdates')
  const chats = new Map()

  for (const update of updates) {
    const message = update.message ?? update.channel_post ?? update.my_chat_member
    const chat = message?.chat
    if (chat) chats.set(chat.id, chat)
  }

  if (chats.size === 0) {
    console.log('\nNo chats yet. Telegram only reveals a chat id after the bot sees a message.')
    console.log('  Direct message: open the bot, press Start, send anything.')
    console.log(`  Group: add @${me.username}, then send "/start@${me.username}".`)
    console.log('    Bots ignore ordinary group messages unless privacy mode is disabled')
    console.log('    via @BotFather → /setprivacy, so mention the bot explicitly.')
    console.log('\nThen run this again. Updates expire after 24 hours.')
    process.exit(0)
  }

  console.log('\nChats this bot can post to:\n')
  for (const chat of chats.values()) {
    const name = chat.title ?? [chat.first_name, chat.last_name].filter(Boolean).join(' ')
    console.log(`  TELEGRAM_CHAT_ID=${chat.id}`)
    console.log(`    ${chat.type}${name ? ` — ${name}` : ''}`)
  }
  console.log('\nCopy the id you want into .env.local.')
} catch (error) {
  console.error(`Telegram rejected the request: ${error.message}`)
  console.error('A 401 means the token is wrong or has been revoked.')
  process.exit(1)
}
