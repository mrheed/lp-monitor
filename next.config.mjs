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
}

export default nextConfig
