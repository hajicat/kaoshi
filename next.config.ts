/** @type {import('next').NextConfig} */
const nextConfig = {
  // 优化：减少 bundle 体积
  experimental: {
    optimizePackageImports: ['lucide-react', 'recharts', 'date-fns'],
  },
};

export default nextConfig;
