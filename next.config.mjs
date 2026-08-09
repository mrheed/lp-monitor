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

    return config
  },
}

export default nextConfig
