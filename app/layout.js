import './globals.css';
import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { Source_Sans_3, Playfair_Display, JetBrains_Mono } from 'next/font/google';
import DevAnnotation from './components/shared/DevAnnotation';

// latin-ext is required for the rupee sign — U+20B9 is not in Google's latin
// subset, so without it every ₹ falls back to a system font with different
// metrics and looks misaligned next to the digits.
const body = Source_Sans_3({ subsets: ['latin', 'latin-ext'], variable: '--font-body', display: 'swap' });
const serif = Playfair_Display({ subsets: ['latin', 'latin-ext'], weight: ['500','600','700','800'], variable: '--font-title', display: 'swap' });
const mono = JetBrains_Mono({ subsets: ['latin', 'latin-ext'], weight: ['400','500','600','700'], variable: '--font-mono', display: 'swap' });

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
    // suppressHydrationWarning: THEME_BOOT sets data-time on <html> before paint,
    // so the client tree intentionally differs from the server's — expected, not a bug.
    <html lang="en" suppressHydrationWarning className={`${body.variable} ${serif.variable} ${mono.variable}`}>
      <body>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
        {children}<Analytics /><SpeedInsights />
        {process.env.NODE_ENV !== 'production' && <DevAnnotation />}
      </body>
    </html>
  );
}
