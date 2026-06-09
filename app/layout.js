import './globals.css';
import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { Source_Sans_3, Playfair_Display, Source_Code_Pro } from 'next/font/google';

const body = Source_Sans_3({ subsets: ['latin'], variable: '--font-body', display: 'swap' });
const serif = Playfair_Display({ subsets: ['latin'], weight: ['500','600','700','800'], variable: '--font-title', display: 'swap' });
const mono = Source_Code_Pro({ subsets: ['latin'], weight: ['400','500','600','700'], variable: '--font-mono', display: 'swap' });

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
    <html lang="en" className={`${body.variable} ${serif.variable} ${mono.variable}`}>
      <body>{children}<Analytics /><SpeedInsights /></body>
    </html>
  );
}
