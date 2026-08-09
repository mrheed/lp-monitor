/**
 * Starts the alert watcher when the server boots.
 *
 * Next calls this once per server process, before any request is handled. Without it the watcher
 * only started from inside the `/api/alerts` handlers, which meant nothing polled and nothing
 * alerted until a browser happened to open the page. Alerting should not depend on someone
 * watching it.
 */
export const register = async () => {
  // Instrumentation also runs on the edge runtime, which has no timers that outlive a request
  // and no filesystem for the watcher's persisted state. Only the Node process should start it.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  // Imported dynamically so the edge bundle never pulls in `node:fs` by way of the watcher.
  const { startAlertWatcher } = await import('./lib/domain/alertWatcher')

  startAlertWatcher()
}
