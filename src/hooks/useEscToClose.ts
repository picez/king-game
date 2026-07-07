import { useEffect } from 'react';

/**
 * Closes a modal/dialog when the user presses Escape. Attaches a single
 * document-level keydown listener while `active` is true and removes it on
 * cleanup, so it is safe to call unconditionally from a component that renders
 * the dialog only some of the time — just pass the open flag as `active`.
 */
export function useEscToClose(onClose: () => void, active = true): void {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, active]);
}
