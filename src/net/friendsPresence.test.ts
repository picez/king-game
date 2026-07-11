import { describe, it, expect, beforeEach } from 'vitest';
import {
  attachPresence, detachPresence, isOnline, onlineAmong, onlineUserIds, resetPresence,
} from '../../server/friendsPresence';

beforeEach(() => resetPresence());

describe('friendsPresence — in-memory, per instance', () => {
  it('attach makes a user online; first socket reports the offline→online transition', () => {
    const s1 = {};
    expect(isOnline('u1')).toBe(false);
    expect(attachPresence('u1', s1)).toBe(true);   // first socket → transition
    expect(isOnline('u1')).toBe(true);
  });

  it('multiple sockets: only the FIRST attach and the LAST detach are transitions', () => {
    const a = {}, b = {};
    expect(attachPresence('u1', a)).toBe(true);     // offline → online
    expect(attachPresence('u1', b)).toBe(false);    // still online (2 sockets)
    expect(isOnline('u1')).toBe(true);
    expect(detachPresence('u1', a)).toBe(false);    // still online (1 socket left)
    expect(isOnline('u1')).toBe(true);
    expect(detachPresence('u1', b)).toBe(true);     // online → offline
    expect(isOnline('u1')).toBe(false);
  });

  it('detach of an unknown user/socket is a safe no-op', () => {
    expect(detachPresence('ghost', {})).toBe(false);
    attachPresence('u1', {});
    expect(detachPresence('u1', {})).toBe(false);   // different socket object → not the last
    expect(isOnline('u1')).toBe(true);
  });

  it('onlineAmong / onlineUserIds reflect who is currently connected', () => {
    attachPresence('u1', {});
    attachPresence('u3', {});
    expect(onlineAmong(['u1', 'u2', 'u3']).sort()).toEqual(['u1', 'u3']);
    expect(onlineUserIds().sort()).toEqual(['u1', 'u3']);
  });
});
