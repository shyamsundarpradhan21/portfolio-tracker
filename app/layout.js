import './globals.css';
import { Analytics } from '@vercel/analytics/next';

export const metadata = {
  title: 'Net Worth — Live',
  description: 'Personal net worth tracker with live NSE & US equity prices.',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0C0C12',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}<Analytics /></body>
    </html>
  );
}
