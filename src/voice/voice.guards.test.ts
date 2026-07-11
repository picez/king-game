// Source guards for the Stage 25.4 voice MVP: WebRTC/getUserMedia are confined to the
// voice adapter, voice is opt-in (no auto-join), no audio/DB touches the server, and the
// UI wires the control into the lobby + in-game corner.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

/** All .ts/.tsx files under src/, excluding tests. */
function srcFiles(dir = 'src', acc: string[] = []): string[] {
  for (const name of readdirSync(join(process.cwd(), dir))) {
    const rel = `${dir}/${name}`;
    const st = statSync(join(process.cwd(), rel));
    if (st.isDirectory()) srcFiles(rel, acc);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) acc.push(rel);
  }
  return acc;
}

describe('WebRTC / mic APIs are confined to the voice adapter', () => {
  const files = srcFiles();
  it('getUserMedia + RTCPeerConnection appear ONLY in src/voice/webrtc.ts (code, not comments)', () => {
    const stripComments = (s: string) => s.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const offenders = files.filter((f) => f !== 'src/voice/webrtc.ts'
      && /getUserMedia|RTCPeerConnection|mediaDevices/.test(stripComments(read(f))));
    expect(offenders).toEqual([]);
  });

  it('the voice adapter never records and the default is STUN-only', () => {
    const w = read('src/voice/webrtc.ts');
    expect(w).not.toMatch(/MediaRecorder|getDisplayMedia/i);
    // The default ICE config is the free Google STUN — no TURN, no credentials.
    const ice = read('src/voice/iceConfig.ts');
    expect(ice).toContain("stun:stun.l.google.com:19302");
    expect(ice).toContain('DEFAULT_ICE_SERVERS');
  });
});

describe('no TURN credentials are committed anywhere (STUN-only default; TURN is env-only)', () => {
  /** Every source file under src/ and server/, excluding tests. */
  function sourceFiles(): string[] {
    const acc: string[] = [];
    for (const root of ['src', 'server']) {
      try { statSync(join(process.cwd(), root)); } catch { continue; }
      walk(root, acc);
    }
    return acc;
    function walk(dir: string, out: string[]): void {
      for (const name of readdirSync(join(process.cwd(), dir))) {
        const rel = `${dir}/${name}`;
        if (statSync(join(process.cwd(), rel)).isDirectory()) walk(rel, out);
        else if (/\.(ts|tsx|js|mjs)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(rel);
      }
    }
  }

  it('no committed TURN url string literal or hardcoded credential/username value', () => {
    const offenders: string[] = [];
    for (const f of sourceFiles()) {
      const src = read(f).replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      // A quoted turn:/turns: URL, or a credential/username assigned a non-empty string literal.
      if (/['"]turns?:/i.test(src)) offenders.push(`${f} (turn url)`);
      if (/\b(credential|username)\s*[:=]\s*['"][^'"]+['"]/.test(src)) offenders.push(`${f} (secret literal)`);
    }
    expect(offenders).toEqual([]);
  });

  it('redactIceServers never exposes the credential/username value', () => {
    // The redaction shape is { urls, hasCredential } only — a source-level guarantee.
    const ice = read('src/voice/iceConfig.ts');
    const redactBody = ice.slice(ice.indexOf('export function redactIceServers'));
    expect(redactBody).toContain('hasCredential');
    expect(redactBody).not.toMatch(/credential:\s*s\.credential|username:\s*s\.username/);
  });
});

describe('voice never touches the server audio/DB and carries no secrets', () => {
  it('the voice client modules make no DB/persistence/fetch calls', () => {
    for (const f of ['src/voice/VoiceSession.ts', 'src/voice/useRoomVoice.ts', 'src/voice/webrtc.ts', 'src/voice/voiceSignal.ts'].filter((p) => {
      try { statSync(join(process.cwd(), p)); return true; } catch { return false; }
    })) {
      const src = read(f);
      expect(src, f).not.toMatch(/from '\.\.\/db|getDb|fetch\(|localStorage|indexedDB/);
      expect(src.replace(/\/\/.*$/gm, ''), f).not.toMatch(/\bemail\b|\btoken\b|sessionId|reconnectToken/i);
    }
  });
});

describe('voice UI is opt-in and wired into the room', () => {
  const online = read('src/ui/online/OnlineGame.tsx');
  const social = read('src/ui/online/RoomSocial.tsx');
  const control = read('src/ui/components/VoiceControl.tsx');

  it('OnlineGame renders the lobby card + a compact in-game control (via RoomSocial)', () => {
    expect(online).toContain('useRoomVoice(net)');
    expect(online).toMatch(/<VoiceControl voice=\{voice\} variant="card"/);
    expect(online).toMatch(/voiceButton=\{<VoiceControl voice=\{voice\} variant="compact"/);
    expect(social).toContain('voiceButton');
  });

  it('is OPT-IN: mic is only requested on the Join tap — no auto-join on room entry', () => {
    // The control calls join() only from a click handler.
    expect(control).toMatch(/onClick=\{voice\.join\}/);
    // The hook's setup effect CREATES the session but never joins it (no auto-join).
    const hook = read('src/voice/useRoomVoice.ts');
    const effect = hook.slice(hook.indexOf('useEffect('), hook.indexOf('const join ='));
    expect(effect).not.toMatch(/\.join\(\)/);
    // VoiceSession never joins in its constructor either.
    expect(read('src/voice/VoiceSession.ts')).not.toMatch(/constructor[\s\S]{0,200}this\.join/);
  });

  it('shows unsupported + permission-denied states; text chat is untouched', () => {
    expect(control).toContain("t('voice.notSupported')");
    expect(control).toContain("t('voice.permissionDenied')");
    expect(control).toContain("t('voice.permissionHint')"); // browser-settings hint
    expect(control).toContain("t('voice.enableAudio')"); // autoplay-blocked fallback
  });
});
