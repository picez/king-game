import { useEffect, useId, useRef, useState } from 'react';

/** One choice in a {@link SelectMenu}. Values are plain strings (callers cast). */
export interface SelectMenuOption {
  value: string;
  label: string;
  sublabel?: string;
  /** Leading emoji/glyph (also used as the tile content in the grid layout). */
  icon?: string;
  disabled?: boolean;
}

interface Props {
  value: string;
  options: SelectMenuOption[];
  onChange: (value: string) => void;
  /** Accessible name for the trigger + listbox. */
  ariaLabel: string;
  /** 'list' = rows (game/language); 'grid' = compact tiles (avatars). */
  layout?: 'list' | 'grid';
  /** Trigger shows only the selected icon (used for the avatar picker). */
  compactTrigger?: boolean;
  className?: string;
}

/**
 * A single reusable custom dropdown (Stage 9.11): a styled button trigger plus a
 * popover listbox — not a native form control. Closes on Escape, outside-click, or
 * selection. All styling is namespaced under `.select-menu*` so it never collides
 * with `.card` / `.table` / other UI. Generic enough for game / avatar / language.
 */
export default function SelectMenu({
  value, options, onChange, ariaLabel, layout = 'list', compactTrigger = false, className = '',
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function pick(o: SelectMenuOption) {
    if (o.disabled) return;
    onChange(o.value);
    setOpen(false);
  }

  return (
    <div className={`select-menu ${open ? 'select-menu--open' : ''} ${className}`} ref={rootRef}>
      <button
        type="button"
        className="select-menu__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="select-menu__value">
          {compactTrigger ? (
            // Icon-only trigger (avatars): fall back to the label glyph if no icon.
            <span className="select-menu__emoji" aria-hidden="true">{selected?.icon ?? selected?.label ?? ''}</span>
          ) : (
            <>
              {selected?.icon && <span className="select-menu__icon" aria-hidden="true">{selected.icon}</span>}
              <span className="select-menu__text">
                <span className="select-menu__label">{selected?.label ?? ''}</span>
                {selected?.sublabel && <span className="select-menu__sub">{selected.sublabel}</span>}
              </span>
            </>
          )}
        </span>
        <span className="select-menu__chevron" aria-hidden="true">▾</span>
      </button>

      {open && (
        <ul className={`select-menu__popover select-menu__popover--${layout}`} role="listbox" aria-label={ariaLabel} id={listId}>
          {options.map((o) => {
            const isSel = o.value === value;
            return (
              <li
                key={o.value}
                role="option"
                aria-selected={isSel}
                aria-disabled={o.disabled || undefined}
                title={o.label}
                className={`select-menu__option ${isSel ? 'select-menu__option--selected' : ''} ${o.disabled ? 'select-menu__option--disabled' : ''}`}
                onClick={() => pick(o)}
              >
                {layout === 'grid' ? (
                  <span className="select-menu__emoji" aria-hidden="true">{o.icon ?? o.label}</span>
                ) : (
                  <>
                    {o.icon && <span className="select-menu__icon" aria-hidden="true">{o.icon}</span>}
                    <span className="select-menu__text">
                      <span className="select-menu__label">{o.label}</span>
                      {o.sublabel && <span className="select-menu__sub">{o.sublabel}</span>}
                    </span>
                  </>
                )}
                <span className={`select-menu__check ${isSel ? 'select-menu__check--on' : ''}`} aria-hidden="true">✓</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
