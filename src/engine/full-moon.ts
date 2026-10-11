/**
 * Full-moon dates in {@link TIME_ZONE}, for the "every full moon" repeat.
 *
 * The instant of each full moon follows Meeus, "Astronomical Algorithms" (2nd ed.), chapter 49: the
 * mean phase plus the periodic and planetary terms. It is good to about a minute for centuries
 * around 2000. The date of an Occurrence is the wall-clock date of that instant in Detroit.
 */
import type { LocalDate } from "./types";
import { utcToWallClock } from "./wall-clock";

const RAD = Math.PI / 180;
const sin = (degrees: number) => Math.sin(degrees * RAD);

/** Lunations per year (Meeus 49.2). */
const LUNATIONS_PER_YEAR = 12.3685;

/** TT − UT in seconds, Espenak and Meeus' fit for 2005–2050 (good enough for dates near it). */
function deltaTSeconds(year: number): number {
  const t = year - 2000;
  return 62.92 + 0.32217 * t + 0.005589 * t * t;
}

/** The instant of full moon number `k` (an integer plus 0.5; k = 0.5 is in January 2000). */
export function fullMoonInstant(k: number): Date {
  const T = k / 1236.85;
  const T2 = T * T;
  const T3 = T2 * T;
  const T4 = T3 * T;

  const jde = 2451550.09766 + 29.530588861 * k + 0.00015437 * T2 - 0.00000015 * T3 + 0.00000000073 * T4;
  const E = 1 - 0.002516 * T - 0.0000074 * T2;
  const M = 2.5534 + 29.1053567 * k - 0.0000014 * T2 - 0.00000011 * T3;
  const Mp = 201.5643 + 385.81693528 * k + 0.0107582 * T2 + 0.00001238 * T3 - 0.000000058 * T4;
  const F = 160.7108 + 390.67050284 * k - 0.0016118 * T2 - 0.00000227 * T3 + 0.000000011 * T4;
  const omega = 124.7746 - 1.56375588 * k + 0.0020672 * T2 + 0.00000215 * T3;

  const periodic =
    -0.40614 * sin(Mp) +
    0.17302 * E * sin(M) +
    0.01614 * sin(2 * Mp) +
    0.01043 * sin(2 * F) +
    0.00734 * E * sin(Mp - M) -
    0.00515 * E * sin(Mp + M) +
    0.00209 * E * E * sin(2 * M) -
    0.00111 * sin(Mp - 2 * F) -
    0.00057 * sin(Mp + 2 * F) +
    0.00056 * E * sin(2 * Mp + M) -
    0.00042 * sin(3 * Mp) +
    0.00042 * E * sin(M + 2 * F) +
    0.00038 * E * sin(M - 2 * F) -
    0.00024 * E * sin(2 * Mp - M) -
    0.00017 * sin(omega) -
    0.00007 * sin(Mp + 2 * M) +
    0.00004 * sin(2 * Mp - 2 * F) +
    0.00004 * sin(3 * M) +
    0.00003 * sin(Mp + M - 2 * F) +
    0.00003 * sin(2 * Mp + 2 * F) -
    0.00003 * sin(Mp + M + 2 * F) +
    0.00003 * sin(Mp - M + 2 * F) -
    0.00002 * sin(Mp - M - 2 * F) -
    0.00002 * sin(3 * Mp + M) +
    0.00002 * sin(4 * Mp);

  const planetary =
    0.000325 * sin(299.77 + 0.107408 * k - 0.009173 * T2) +
    0.000165 * sin(251.88 + 0.016321 * k) +
    0.000164 * sin(251.83 + 26.651886 * k) +
    0.000126 * sin(349.42 + 36.412478 * k) +
    0.00011 * sin(84.66 + 18.206239 * k) +
    0.000062 * sin(141.74 + 53.303771 * k) +
    0.00006 * sin(207.14 + 2.453732 * k) +
    0.000056 * sin(154.84 + 7.30686 * k) +
    0.000047 * sin(34.52 + 27.261239 * k) +
    0.000042 * sin(207.19 + 0.121824 * k) +
    0.00004 * sin(291.34 + 1.844379 * k) +
    0.000037 * sin(161.72 + 24.198154 * k) +
    0.000035 * sin(239.56 + 25.513099 * k) +
    0.000023 * sin(331.55 + 3.592518 * k);

  const julianDay = jde + periodic + planetary;
  const year = 2000 + k / LUNATIONS_PER_YEAR;
  // Julian day 2440587.5 is 1970-01-01T00:00Z.
  return new Date((julianDay - 2440587.5) * 86_400_000 - deltaTSeconds(year) * 1000);
}

/** Detroit dates of the full moons from `from` to `to`, both included, in order. */
export function fullMoonDates(from: LocalDate, to: LocalDate): LocalDate[] {
  const dates: LocalDate[] = [];
  if (to < from) return dates;
  // Start one lunation early: the estimate of k can be off by one.
  const year = Number(from.slice(0, 4)) + (Number(from.slice(5, 7)) - 1) / 12;
  let k = Math.floor((year - 2000) * LUNATIONS_PER_YEAR) - 1.5;
  for (;;) {
    const date = utcToWallClock(fullMoonInstant(k)).slice(0, 10);
    if (date > to) return dates;
    if (date >= from) dates.push(date);
    k += 1;
  }
}
