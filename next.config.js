/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  allowedDevOrigins: ['localhost', '127.0.0.1'],
  // Turbopack is default in Next.js 16
  turbopack: {},
  serverExternalPackages: ['onnxruntime-node'],
}

module.exports = nextConfig
