// One browser User-Agent string shared by every server-side fetcher (Yahoo / NSE / AMFI /
// news). The data sources gate on a browser-like UA, so they must all send the same one —
// kept here so a UA bump is a single edit, not a 14-file sweep.
export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
