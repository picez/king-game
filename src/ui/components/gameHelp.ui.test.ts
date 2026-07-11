import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Stage 22.0 — generic quick-rules "How to play" sheet. Source-level contract (no
// testing-library): the modal renders the help catalog via t(), and the game picker
// exposes a single trigger that opens it for the selected game.

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const modal = read('src/ui/components/GameHelpModal.tsx');
const menu = read('src/ui/StartMenu.tsx');

describe('GameHelpModal — generic, data-driven from the help catalog', () => {
  it('renders each section label + content from gameHelp + i18n', () => {
    expect(modal).toContain("from '../../games/gameHelp'");
    expect(modal).toContain('const entry = gameHelp(game)');
    expect(modal).toContain('entry.sections.map');
    expect(modal).toContain('t(helpLabelKey(section))');
    expect(modal).toContain('t(helpContentKey(game, section))');
    expect(modal).toContain("t('help.howToPlay')");
    expect(modal).toContain("t('help.gotIt')");
  });

  it('is an accessible, esc-closable dialog and imports no gameplay/engine code', () => {
    expect(modal).toContain('role="dialog"');
    expect(modal).toContain('aria-modal="true"');
    expect(modal).toContain('useEscToClose(onClose)');
    // Pure presentational: no reducer/engine/net/server imports.
    expect(modal).not.toMatch(/from '\.\.\/\.\.\/games\/[a-z]+\/(engine|ai|rules)'/);
    expect(modal).not.toMatch(/from '\.\.\/\.\.\/net\//);
  });
});

describe('StartMenu — the game picker opens the help sheet for the selected game', () => {
  it('wires a How-to-play trigger + the modal, keyed to the current gameType', () => {
    expect(menu).toContain("import GameHelpModal from './components/GameHelpModal'");
    expect(menu).toContain('const [showHelp, setShowHelp] = useState(false)');
    expect(menu).toContain("t('help.howToPlay')");
    expect(menu).toContain('<GameHelpModal game={gameType} onClose={() => setShowHelp(false)} />');
  });
});
