import { describe, expect, it } from 'vitest';
import { PermissionFlagsBits as P } from 'discord-api-types/v10';
import {
  ALL_PERMISSIONS,
  computeChannelPermissions,
  hasPermission,
} from '../../src/discord/permissions';

const G = '100000000000000000';
const OWNER = '200000000000000000';
const s = (b: bigint) => b.toString();

const roles = [
  { id: G, permissions: s(P.ViewChannel | P.SendMessages) },
  { id: 'r_editor', permissions: s(P.MentionEveryone) },
  { id: 'r_admin', permissions: s(P.Administrator) },
  { id: 'r_quiet', permissions: '0' },
];

function perms(member: { userId: string; roleIds: string[] }, overwrites: any[] = []) {
  return computeChannelPermissions({ guildId: G, ownerId: OWNER, roles, member, overwrites });
}

describe('computeChannelPermissions', () => {
  it('gives the owner everything', () => {
    expect(perms({ userId: OWNER, roleIds: [] })).toBe(ALL_PERMISSIONS);
  });

  it('gives administrators everything regardless of overwrites', () => {
    const p = perms({ userId: 'u', roleIds: ['r_admin'] }, [
      { id: G, type: 0, allow: '0', deny: s(P.ViewChannel) },
    ]);
    expect(p).toBe(ALL_PERMISSIONS);
  });

  it('unions @everyone with member roles', () => {
    const p = perms({ userId: 'u', roleIds: ['r_editor'] });
    expect(hasPermission(p, P.ViewChannel)).toBe(true);
    expect(hasPermission(p, P.SendMessages)).toBe(true);
    expect(hasPermission(p, P.MentionEveryone)).toBe(true);
    expect(hasPermission(p, P.ManageChannels)).toBe(false);
  });

  it('applies the @everyone overwrite, then role overwrites (deny then allow)', () => {
    // private channel: @everyone denied, r_editor allowed back in
    const overwrites = [
      { id: G, type: 0, allow: '0', deny: s(P.ViewChannel | P.SendMessages) },
      { id: 'r_editor', type: 0, allow: s(P.ViewChannel | P.SendMessages), deny: '0' },
    ];
    expect(
      hasPermission(perms({ userId: 'u', roleIds: ['r_quiet'] }, overwrites), P.ViewChannel),
    ).toBe(false);
    const editor = perms({ userId: 'u', roleIds: ['r_editor'] }, overwrites);
    expect(hasPermission(editor, P.ViewChannel)).toBe(true);
    expect(hasPermission(editor, P.SendMessages)).toBe(true);
  });

  it('lets a role allow win over another role deny, and the member overwrite win over roles', () => {
    const overwrites = [
      { id: 'r_quiet', type: 0, allow: '0', deny: s(P.SendMessages) },
      { id: 'r_editor', type: 0, allow: s(P.SendMessages), deny: '0' },
      { id: 'u', type: 1, allow: '0', deny: s(P.SendMessages) },
    ];
    const both = perms({ userId: 'other', roleIds: ['r_quiet', 'r_editor'] }, overwrites);
    expect(hasPermission(both, P.SendMessages)).toBe(true);
    const member = perms({ userId: 'u', roleIds: ['r_quiet', 'r_editor'] }, overwrites);
    expect(hasPermission(member, P.SendMessages)).toBe(false);
  });

  it('ignores overwrites for roles the member does not have', () => {
    const p = perms({ userId: 'u', roleIds: [] }, [
      { id: 'r_editor', type: 0, allow: s(P.MentionEveryone), deny: '0' },
    ]);
    expect(hasPermission(p, P.MentionEveryone)).toBe(false);
  });
});
