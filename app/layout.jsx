import './globals.css';

export const metadata = {
  title: '福尔摩搜 · AI侦探社',
  description: '用元宝搜索做会查的 AI：搜索、核对、溯源，把结论的来路查清楚。',
};

export const viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
