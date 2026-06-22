// SPDX-License-Identifier: MPL-2.0
import type { DisplayInfo } from '../types.js';

/**
 * Detect display / locale info.
 *
 * All underlying APIs (`screen`, `window.devicePixelRatio`,
 * `navigator.language/languages/maxTouchPoints`,
 * `Intl.DateTimeFormat`) are synchronous and almost-universally
 * supported. They can still throw in unusual SSR/WindowProxy
 * contexts, so each access is individually guarded and degrades
 * to `null`. Errors do not bubble up; this function never throws.
 *
 * Browsers: universal.
 */
export function detectDisplay(): DisplayInfo {
  const screenWidth = readNumber(() => screen?.width);
  const screenHeight = readNumber(() => screen?.height);
  const dpr = readNumber(() => window?.devicePixelRatio);
  const colorDepth = readNumber(() => screen?.colorDepth);

  let language: string | null = null;
  let languages: string[] = [];
  try {
    const nav = navigator;
    language = typeof nav?.language === 'string' && nav.language.length > 0 ? nav.language : null;
    if (Array.isArray(nav?.languages)) {
      languages = nav.languages.filter((l): l is string => typeof l === 'string' && l.length > 0);
    }
  } catch {}

  let timeZone: string | null = null;
  try {
    const opts = new Intl.DateTimeFormat().resolvedOptions();
    timeZone = typeof opts.timeZone === 'string' && opts.timeZone.length > 0 ? opts.timeZone : null;
  } catch {}

  let maxTouchPoints = 0;
  try {
    const mt = navigator?.maxTouchPoints;
    if (typeof mt === 'number' && Number.isFinite(mt) && mt >= 0) {
      maxTouchPoints = Math.floor(mt);
    }
  } catch {}

  return {
    screenWidth,
    screenHeight,
    devicePixelRatio: dpr,
    colorDepth,
    language,
    languages,
    timeZone,
    maxTouchPoints,
  };
}

/** Read a number safely; returns `null` on throw / undefined / NaN. */
function readNumber(fn: () => unknown): number | null {
  try {
    const v = fn();
    return typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : null;
  } catch {
    return null;
  }
}
