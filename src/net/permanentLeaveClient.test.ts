// ---------------------------------------------------------------------------
// Stage 38.0.5.1 — the CLIENT half of the permanent-leave contract.
//
// Two ordering defects, reproduced as tests before the fix:
//  A. duplicate intent — `leavePermanently` gated only on React state, which is written
//     asynchronously. Two presses before the next render both saw `idle` and both sent
//     `LEAVE_GAME_PERMANENTLY`.
//  B. ACK vs a late refusal — the server answers a duplicate intent, that answer arrives
//     AFTER `PERMANENT_LEAVE_ACCEPTED`, and the UI flipped `accepted` → `error`, telling
//     the player the table was still theirs after the seat had provably been taken over.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  planLeaveIntent, applyLeaveAccepted, applyLeaveRefusal, type PermanentLeaveStatus,
} from './permanentLeaveClient';

/** A faithful stand-in for the hook: a SYNCHRONOUS status + a wire log. */
function client() {
  let status: PermanentLeaveStatus = 'idle';
  const sent: string[] = [];
  return {
    get status() { return status; },
    sent,
    press() {
      const plan = planLeaveIntent(status);
      if (!plan.send) return;
      status = plan.next;
      sent.push('LEAVE_GAME_PERMANENTLY');
    },
    ack() { status = applyLeaveAccepted(status).next; },
    refuse() { const r = applyLeaveRefusal(status); if (r.apply) status = r.next; },
  };
}

describe('A — single flight (duplicate intent before the next render)', () => {
  it('two presses in the SAME tick send exactly one intent', () => {
    const c = client();
    c.press();
    c.press();                          // no render happened in between
    expect(c.sent).toEqual(['LEAVE_GAME_PERMANENTLY']);
    expect(c.status).toBe('pending');
  });

  it('five rapid presses still send one', () => {
    const c = client();
    for (let i = 0; i < 5; i++) c.press();
    expect(c.sent).toHaveLength(1);
  });

  it('pressing again AFTER the ACK sends nothing (the seat is gone)', () => {
    const c = client();
    c.press();
    c.ack();
    c.press();
    expect(c.sent).toHaveLength(1);
    expect(c.status).toBe('accepted');
  });

  it('a refusal DOES re-open the door — nothing changed server-side, so a retry is legal', () => {
    const c = client();
    c.press();
    c.refuse();
    expect(c.status).toBe('error');
    c.press();
    expect(c.sent).toHaveLength(2);
    expect(c.status).toBe('pending');
  });
});

describe('B — the ACK is terminal and absorbing', () => {
  it('a duplicate refusal arriving AFTER the ACK never repaints it as an error', () => {
    const c = client();
    c.press();
    c.ack();
    c.refuse();                         // the server answering the duplicate intent
    expect(c.status).toBe('accepted');
  });

  it('the ordering the other way round still ends at accepted', () => {
    const c = client();
    c.press();
    c.refuse();                         // first request refused…
    c.press();                          // …retried…
    c.ack();                            // …and accepted
    c.refuse();                         // a late straggler for the first attempt
    expect(c.status).toBe('accepted');
  });

  it('the ACK can arrive in ANY state, including idle (a re-ACKed duplicate)', () => {
    for (const from of ['idle', 'pending', 'error', 'accepted'] as PermanentLeaveStatus[]) {
      expect(applyLeaveAccepted(from).next).toBe('accepted');
    }
    expect(applyLeaveAccepted('accepted').changed).toBe(false);
    expect(applyLeaveAccepted('pending').changed).toBe(true);
  });

  it('a refusal is applied from every non-accepted state and never from accepted', () => {
    expect(applyLeaveRefusal('idle')).toEqual({ apply: true, next: 'error' });
    expect(applyLeaveRefusal('pending')).toEqual({ apply: true, next: 'error' });
    expect(applyLeaveRefusal('error')).toEqual({ apply: true, next: 'error' });
    expect(applyLeaveRefusal('accepted')).toEqual({ apply: false, next: 'accepted' });
  });
});

describe('the hook actually uses the synchronous guard (not React state)', () => {
  const hook = readFileSync(join(process.cwd(), 'src/hooks/useNetworkGame.ts'), 'utf8');
  const server = readFileSync(join(process.cwd(), 'server/index.ts'), 'utf8');

  it('the intent is planned from a ref, and the ref is written before the send', () => {
    const fn = hook.slice(hook.indexOf('const leavePermanently'), hook.indexOf('const backToMenu'));
    expect(fn).toContain('planLeaveIntent(permanentLeaveRef.current)');
    expect(fn).toMatch(/if \(!plan\.send\) return;[\s\S]*writePermanentLeave\(plan\.next\)[\s\S]*send\(\{ t: 'LEAVE_GAME_PERMANENTLY' \}\)/);
    // The old state-only guard is gone.
    expect(fn).not.toContain('setPermanentLeave((p)');
  });

  it('every status write goes through the helper that keeps the ref in sync', () => {
    // Exactly one direct setState (the initial useState); everything else uses the helper.
    expect((hook.match(/setPermanentLeave\(/g) ?? []).length).toBe(1);
    // Intent + ACK + refusal — the three places the status can change.
    expect((hook.match(/writePermanentLeave\(/g) ?? []).length).toBe(3);
  });

  it('the refusal branch consults applyLeaveRefusal before touching the UI', () => {
    expect(hook).toMatch(/PERMANENT_LEAVE_UNAVAILABLE'\) \{[\s\S]*?applyLeaveRefusal\(permanentLeaveRef\.current\)[\s\S]*?if \(refusal\.apply\)/);
  });

  it('the server re-ACKs a duplicate intent instead of answering ERROR', () => {
    expect(server).toContain('const permanentlyLeftSockets = new WeakSet<WebSocket>()');
    expect(server).toMatch(/if \(permanentlyLeftSockets\.has\(socket\)\) \{ send\(socket, \{ t: 'PERMANENT_LEAVE_ACCEPTED' \}\); return; \}/);
    // …and the socket is only marked AFTER a successful, completed transition.
    expect(server).toMatch(/if \(!result\.ok\) \{ refuse\(\); return; \}[\s\S]{0,300}permanentlyLeftSockets\.add\(socket\)/);
  });
});
