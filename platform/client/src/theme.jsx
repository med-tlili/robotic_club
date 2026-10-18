// ============================================================
//  theme.jsx — light / dark appearance + motion preference
//
//  The choice lives in localStorage (it must apply on the login
//  page too, before anyone is signed in) and is expressed purely
//  as attributes on <html>: the CSS token blocks do the rest, so
//  no component needs to know which theme is active.
//
//    <html data-theme="light|dark">   ← resolved from 'system'|'light'|'dark'
//    <html data-motion="reduced">     ← user asked for less motion
// ============================================================
import { createContext, useContext, useEffect, useState } from 'react';

const THEME_KEY = 'isigk:theme'; // 'system' | 'light' | 'dark'
const MOTION_KEY = 'isigk:motion'; // 'full' | 'reduced'

const ThemeContext = createContext(null);

const read = (key, fallback) => {
  try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
};
const write = (key, value) => {
  try { localStorage.setItem(key, value); } catch { /* private mode — ignore */ }
};

const systemPrefersDark = () =>
  typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : false;

// the concrete theme a preference resolves to right now
export function resolveTheme(pref) {
  return pref === 'dark' || (pref === 'system' && systemPrefersDark()) ? 'dark' : 'light';
}

// applied once in main.jsx, before React renders, to avoid a flash
export function initTheme() {
  document.documentElement.dataset.theme = resolveTheme(read(THEME_KEY, 'system'));
  if (read(MOTION_KEY, 'full') === 'reduced') {
    document.documentElement.dataset.motion = 'reduced';
  }
}

export function ThemeProvider({ children }) {
  const [pref, setPref] = useState(() => read(THEME_KEY, 'system'));
  const [motion, setMotion] = useState(() => read(MOTION_KEY, 'full'));

  useEffect(() => {
    document.documentElement.dataset.theme = resolveTheme(pref);
    write(THEME_KEY, pref);
    if (pref !== 'system' || !window.matchMedia) return undefined;
    // follow the OS live while the user is on "System"
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => { document.documentElement.dataset.theme = resolveTheme('system'); };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [pref]);

  useEffect(() => {
    if (motion === 'reduced') document.documentElement.dataset.motion = 'reduced';
    else delete document.documentElement.dataset.motion;
    write(MOTION_KEY, motion);
  }, [motion]);

  const value = {
    pref, setPref, motion, setMotion, resolved: resolveTheme(pref),
  };
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}
