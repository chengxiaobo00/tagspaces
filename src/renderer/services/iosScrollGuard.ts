/**
 * TagSpaces - universal file and folder organizer
 * Copyright (C) 2017-present TagSpaces GmbH
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License (version 3) as
 * published by the Free Software Foundation.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 *
 */

import AppConfig from '-/AppConfig';

/**
 * iOS (WKWebView) phantom-scroll guard.
 *
 * The app shell pins `body`/`html` with `overflow: hidden` (app.global.css), so
 * the document itself should never scroll — all real scrolling happens in inner
 * `overflow: auto` containers. WKWebView nonetheless scrolls the whole document
 * up (~20px) to bring a focused input above the keyboard, or on a rubber-band
 * gesture, and frequently leaves it stuck there — the user then sees the entire
 * UI shifted up until the app is restarted.
 *
 * This snaps the document back to the top whenever it drifts, but deliberately
 * NOT while a field is being edited, so we don't fight iOS scrolling a focused
 * input into view. iOS-only (Capacitor or Cordova); a no-op everywhere else.
 */
export function installIosScrollGuard(): void {
  if (!(AppConfig.isCapacitoriOS || AppConfig.isCordovaiOS)) return;

  const isEditing = (): boolean => {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return false;
    return (
      el.tagName === 'INPUT' ||
      el.tagName === 'TEXTAREA' ||
      el.isContentEditable
    );
  };

  const pin = (): void => {
    const scroller = (document.scrollingElement ||
      document.documentElement) as HTMLElement | null;
    if (scroller && scroller.scrollTop !== 0) scroller.scrollTop = 0;
    if (window.scrollY !== 0 || window.scrollX !== 0) window.scrollTo(0, 0);
  };

  // A stray document scroll while nothing is focused → snap straight back.
  window.addEventListener(
    'scroll',
    () => {
      if (!isEditing()) pin();
    },
    { passive: true },
  );

  // The shift most often "sticks" when the keyboard dismisses / a field blurs.
  // Defer so it runs after focus settles and after the keyboard-hide animation;
  // skip if focus merely moved to another field (keyboard still up).
  document.addEventListener(
    'focusout',
    () => {
      setTimeout(() => {
        if (!isEditing()) pin();
      }, 0);
      setTimeout(() => {
        if (!isEditing()) pin();
      }, 300);
    },
    { passive: true },
  );

  // visualViewport resizes on keyboard show/hide; reset once it's dismissed.
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
      if (!isEditing()) pin();
    });
  }
}
