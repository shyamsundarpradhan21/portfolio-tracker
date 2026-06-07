import './globals.css';
import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { Inter, DM_Serif_Display, JetBrains_Mono } from 'next/font/google';

const inter = Inter({ subsets: ['latin'], variable: '--font-body', display: 'swap' });
const serif = DM_Serif_Display({ subsets: ['latin'], weight: '400', variable: '--font-title', display: 'swap' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono', display: 'swap' });

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
    <html lang="en" className={`${inter.variable} ${serif.variable} ${mono.variable}`}>
      <body>{children}<Analytics /><SpeedInsights /></body>
    </html>
  );
}
