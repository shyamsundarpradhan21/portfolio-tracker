import './globals.css';
import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { Source_Sans_3, Playfair_Display, IBM_Plex_Mono } from 'next/font/google';

// IBM Plex Mono natively covers U+20B9 (₹) and renders $ on the same baseline
// as digits — verified via fontTools. Fira Code / Source Code Pro / JetBrains
// Mono all lack the rupee glyph and fall back to a system font.
const body = Source_Sans_3({ subsets: ['latin', 'latin-ext'], variable: '--font-body', display: 'swap' });
const serif = Playfair_Display({ subsets: ['latin', 'latin-ext'], weight: ['500','600','700','800'], variable: '--font-title', display: 'swap' });
const mono = IBM_Plex_Mono({ subsets: ['latin', 'latin-ext'], weight: ['400','500','600','700'], variable: '--font-mono', display: 'swap' });

export const metadata = {
  title: 'Net Worth — Live',
  description: 'Personal net worth tracker with live NSE & US equity prices.',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0C0C12',
};

// Set day/night before first paint so day-theme users don't get a dark flash
// while React hydrates. 7am–7pm approximation; the client effect refines it to
// real sunrise/sunset (and the persisted manual mode) right after mount.
const THEME_BOOT =
  "try{var m=localStorage.getItem('nwTracker.theme')||'auto';var h=(new Date).getHours();" +
  "document.documentElement.dataset.time=(m==='day'||(m==='auto'&&h>=7&&h<19))?'day':'night'}catch(e){}";

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${body.variable} ${serif.variable} ${mono.variable}`}>
      <body>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
        {children}<Analytics /><SpeedInsights />
      </body>
    </html>
  );
}
