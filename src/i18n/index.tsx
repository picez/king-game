import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';
import { loadLang, saveLang } from '../net/prefs';
import SelectMenu from '../ui/components/SelectMenu';
// Translation dictionaries (Stage 8.2): one file per language under
// ./dictionaries/. Keys are unchanged; English is the source/fallback used by
// translate() and I18N_KEYS below.
// Stage 44.2: only English ships in the main bundle; uk/de/ar are separate chunks
// loaded on demand (main.tsx awaits the saved language before the first render,
// so there is no English flash). Tests register all four (src/i18n/testSetup.ts).
import { EN } from './dictionaries/en';

export type Lang = 'en' | 'uk' | 'de' | 'ar';
export const LANGS: { code: Lang; label: string; flag: string }[] = [
  { code: 'en', label: 'English', flag: '🇬🇧' },
  { code: 'uk', label: 'Українська', flag: '🇺🇦' },
  { code: 'de', label: 'Deutsch', flag: '🇩🇪' },
  { code: 'ar', label: 'العربية', flag: '🇸🇦' },
];

export function isRtl(lang: Lang): boolean {
  return lang === 'ar';
}

type Dict = Record<string, string>;

const DICTS: Partial<Record<Lang, Dict>> = { en: EN };

const LOADERS: Record<Exclude<Lang, 'en'>, () => Promise<Dict>> = {
  uk: () => import('./dictionaries/uk').then((m) => m.UK),
  de: () => import('./dictionaries/de').then((m) => m.DE),
  ar: () => import('./dictionaries/ar').then((m) => m.AR),
};

/** Makes a dictionary available synchronously (the loader, tests). */
export function registerDict(lang: Lang, dict: Dict): void { DICTS[lang] = dict; }
export function isLangLoaded(lang: Lang): boolean { return DICTS[lang] !== undefined; }

const pending = new Map<Lang, Promise<void>>();
/** Loads a language's dictionary once. Never rejects: a failure leaves the English fallback. */
export function ensureLang(lang: Lang): Promise<void> {
  if (isLangLoaded(lang) || lang === 'en') return Promise.resolve();
  let p = pending.get(lang);
  if (!p) {
    p = LOADERS[lang]().then((d) => registerDict(lang, d)).catch(() => { pending.delete(lang); });
    pending.set(lang, p);
  }
  return p;
}

/** Awaited by every entry point before its first render. */
export function preloadInitialLang(): Promise<void> { return ensureLang(initialLang()); }

/** Every translation key (English is the source of truth). Exposed for tests. */
export const I18N_KEYS: string[] = Object.keys(EN);

/** Pure translator: chosen language → English fallback → the key itself. */
export function translate(lang: Lang, key: string): string {
  return DICTS[lang]?.[key] ?? EN[key] ?? key;
}

interface LangCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string) => string;
  dir: 'ltr' | 'rtl';
}

const Ctx = createContext<LangCtx>({ lang: 'en', setLang: () => {}, t: (k) => translate('en', k), dir: 'ltr' });

function initialLang(): Lang {
  const saved = loadLang();
  return (saved && ['en', 'uk', 'de', 'ar'].includes(saved) ? saved : 'en') as Lang;
}

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  // Bumped when a dictionary arrives, so `t` re-renders consumers with real text.
  const [loaded, setLoaded] = useState(() => isLangLoaded(lang));

  useEffect(() => {
    if (isLangLoaded(lang)) { setLoaded(true); return; }
    let live = true;
    setLoaded(false);
    void ensureLang(lang).then(() => { if (live) setLoaded(isLangLoaded(lang)); });
    return () => { live = false; };
  }, [lang]);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = lang;
      document.documentElement.dir = isRtl(lang) ? 'rtl' : 'ltr';
    }
  }, [lang]);

  const setLang = useCallback((l: Lang) => {
    saveLang(l);
    // Switch once the dictionary is in, so the screen never flashes English.
    void ensureLang(l).then(() => setLangState(l));
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const t = useCallback((key: string) => translate(lang, key), [lang, loaded]);

  // Memoize the context value so consumers only re-render when the language
  // actually changes, not on every LangProvider render.
  const value = useMemo<LangCtx>(
    () => ({ lang, setLang, t, dir: isRtl(lang) ? 'rtl' : 'ltr' }),
    [lang, setLang, t],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): LangCtx {
  return useContext(Ctx);
}

export function LanguageSelector() {
  const { lang, setLang } = useI18n();
  return (
    <SelectMenu
      ariaLabel="Language"
      className="lang-select"
      value={lang}
      onChange={(v) => setLang(v as Lang)}
      options={LANGS.map((l) => ({ value: l.code, label: l.label, icon: l.flag }))}
    />
  );
}
