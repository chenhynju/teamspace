import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'TeamSpace - 企业项目协作云',
  description: '多租户 B2B 企业协作平台',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
