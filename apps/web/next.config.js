/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Docker 部署用：产物自带 node_modules 裁剪，next start 免装依赖
  output: 'standalone',
};
module.exports = nextConfig;
