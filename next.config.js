/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, { isServer, nextRuntime }) => {
    // Don't bundle Node.js modules for edge runtime
    if (nextRuntime === 'edge') {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        crypto: false,
        path: false,
        fs: false,
        os: false,
        stream: false,
        buffer: false,
      }
    }
    return config
  },
}

module.exports = nextConfig
