// Sunrise/sunset for a given date + location, via the standard sunrise
// equation (https://en.wikipedia.org/wiki/Sunrise_equation). No network calls.
// Returns { sunrise, sunset } as Date objects (or null if the sun never
// rises/sets that day at that latitude).

const RAD = Math.PI / 180;
const J2000 = 2451545;
const J1970 = 2440587.5;

const toJulian = (date) => date.valueOf() / 86400000 + J1970;
const fromJulian = (j) => new Date((j - J1970) * 86400000);

export function sunTimes(date, lat, lng) {
  const lw = -lng;                                  // west longitude, degrees
  const n = Math.round(toJulian(date) - J2000 - 0.0009);
  const Jstar = n + 0.0009 + lw / 360;              // mean solar noon
  const M = (357.5291 + 0.98560028 * Jstar) % 360;  // solar mean anomaly, deg
  const Mr = M * RAD;
  const C = 1.9148 * Math.sin(Mr) + 0.02 * Math.sin(2 * Mr) + 0.0003 * Math.sin(3 * Mr);
  const lambda = ((M + C + 180 + 102.9372) % 360) * RAD; // ecliptic longitude
  const Jtransit = J2000 + Jstar + 0.0053 * Math.sin(Mr) - 0.0069 * Math.sin(2 * lambda);
  const delta = Math.asin(Math.sin(lambda) * Math.sin(23.44 * RAD)); // declination

  const cosOmega =
    (Math.sin(-0.833 * RAD) - Math.sin(lat * RAD) * Math.sin(delta)) /
    (Math.cos(lat * RAD) * Math.cos(delta));
  if (cosOmega > 1 || cosOmega < -1) return { sunrise: null, sunset: null }; // polar day/night

  const omega = Math.acos(cosOmega) / RAD; // hour angle, degrees
  const Jset = Jtransit + omega / 360;
  const Jrise = Jtransit - omega / 360;
  return { sunrise: fromJulian(Jrise), sunset: fromJulian(Jset) };
}

// Decide 'day' vs 'night' for `now` at a location, falling back to a simple
// 7am–7pm rule if the sun calc is unavailable (e.g. polar regions).
export function dayOrNight(now, lat, lng) {
  const { sunrise, sunset } = sunTimes(now, lat, lng);
  if (!sunrise || !sunset) {
    const h = now.getHours();
    return h >= 7 && h < 19 ? 'day' : 'night';
  }
  return now >= sunrise && now < sunset ? 'day' : 'night';
}
