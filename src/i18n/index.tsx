import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import { loadLang, saveLang } from '../net/prefs';
import SelectMenu from '../ui/components/SelectMenu';
// Translation dictionaries (Stage 8.2): one file per language under
// ./dictionaries/. Keys are unchanged; English is the source/fallback used by
// translate() and I18N_KEYS below.
import { EN } from './dictionaries/en';
import { UK } from './dictionaries/uk';
import { DE } from './dictionaries/de';
import { AR } from './dictionaries/ar';

export type Lang = 'en' | 'uk' | 'de' | 'ar';
export const LANGS: { code: Lang; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'uk', label: 'Українська' },
  { code: 'de', label: 'Deutsch' },
  { code: 'ar', label: 'العربية' },
];

export function isRtl(lang: Lang): boolean {
  return lang === 'ar';
}

type Dict = Record<string, string>;

const DICTS: Record<Lang, Dict> = { en: EN, uk: UK, de: DE, ar: AR };

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

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = lang;
      document.documentElement.dir = isRtl(lang) ? 'rtl' : 'ltr';
    }
  }, [lang]);

  const setLang = useCallback((l: Lang) => { saveLang(l); setLangState(l); }, []);
  const t = useCallback((key: string) => translate(lang, key), [lang]);

  return (
    <Ctx.Provider value={{ lang, setLang, t, dir: isRtl(lang) ? 'rtl' : 'ltr' }}>
      {children}
    </Ctx.Provider>
  );
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
      options={LANGS.map((l) => ({ value: l.code, label: l.label, icon: '🌐' }))}
    />
  );
}
