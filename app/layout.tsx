import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'PikPak 落盘助手',
  description: '在小米 NAS 上浏览并下载 PikPak 云盘文件',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
