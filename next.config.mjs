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
      config.resolve.fallback = { ...config.resolve.fallback, fs: false }
    }

    /*
     * The x402 payment packages are optional peers of @coinbase/cdp-sdk, which arrives through
     * wagmi's connectors. The SDK marks them optional in its own package.json and imports them
     * lazily behind a try/catch that only runs if x402 payment signing is called, which nothing
     * here does. Webpack still insists on resolving the specifiers at build time and fails the
     * build over packages that are absent by design; aliasing them to false resolves each as an
     * empty module instead.
     */
    config.resolve.alias = {
      ...config.resolve.alias,
      '@x402/core/client': false,
      '@x402/evm/exact/client': false,
      '@x402/evm/upto/client': false,
      '@x402/svm/exact/client': false,
    }

    return config
  },
}

export default nextConfig
