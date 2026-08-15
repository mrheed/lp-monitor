/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  /*
   * undici is required at runtime, never bundled.
   *
   * Its entry point reaches `node:console`, which the bundler cannot resolve, and it is only
   * loaded at all when KRYSTAL_PROXY_URL is set. Node resolves it directly instead.
   */
  serverExternalPackages: ['undici'],

  /*
   * The edge runtime has no filesystem, and Next compiles instrumentation for it as well as for
   * Node. The watcher's `NEXT_RUNTIME` guard stops it running there, but that is a runtime check
   * and the bundler still resolves the whole import graph, so `fs` has to resolve to something.
   *
   * Stubbed to `false` for every build except the Node server one, where the real module is
   * wanted and is the only place the guard lets the code run.
   */
  webpack: (config, { isServer, nextRuntime }) => {
    if (!isServer || nextRuntime === 'edge') {
      // `crypto` joins fs for the same reason: @coinbase/cdp-sdk imports the builtin bare, and
      // the browser bundle has no polyfill. The importing utilities belong to CDP's server-side
      // API workflows, which the wallet connector path never calls.
      config.resolve.fallback = { ...config.resolve.fallback, fs: false, crypto: false }
    }

    /*
     * The x402 payment packages are optional peers of @coinbase/cdp-sdk, which arrives through
     * wagmi's connectors. The SDK marks them optional in its own package.json and reaches them
     * only from code paths that sign x402 payments, which nothing here does. Webpack still
     * insists on resolving every specifier at build time and fails the build over packages that
     * are absent by design.
     *
     * Aliased at the package root, which webpack prefix-matches over every subpath. The first
     * version of this fix listed the four dynamically imported subpaths and lasted one day: a
     * lazily loaded module inside the SDK statically imports the bare package, and the full
     * import set across its x402 code spans six packages and a dozen entry points.
     */
    for (const missing of [
      '@x402/core',
      '@x402/evm',
      '@x402/svm',
      '@x402/extensions',
      '@x402/express',
      '@x402/fetch',
    ]) {
      config.resolve.alias = { ...config.resolve.alias, [missing]: false }
    }

    return config
  },
}

export default nextConfig
