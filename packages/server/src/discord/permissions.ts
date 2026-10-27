import { OverwriteType, PermissionFlagsBits } from 'discord-api-types/v10';

/** Every permission bit, used for owners and administrators. */
export const ALL_PERMISSIONS: bigint = Object.values(PermissionFlagsBits).reduce(
  (acc, bit) => acc | bit,
  0n,
);

export interface PermissionRole {
  id: string;
  permissions: string;
}

export interface PermissionOverwrite {
  id: string;
  /** 0 = role, 1 = member (discord-api-types OverwriteType). */
  type: number;
  allow: string;
  deny: string;
}

export interface ComputePermissionsInput {
  guildId: string;
  ownerId: string;
  /** All roles of the guild (the @everyone role has id === guildId). */
  roles: PermissionRole[];
  member: { userId: string; roleIds: string[] };
  /** Overwrites of the channel (for threads: of the parent channel). */
  overwrites: PermissionOverwrite[];
}

/**
 * Discord's effective-permission algorithm for a member in a channel:
 * owner → everything; base = @everyone ∪ member roles; ADMINISTRATOR → everything;
 * then the @everyone overwrite, then the union of role overwrites, then the member overwrite.
 */
export function computeChannelPermissions(input: ComputePermissionsInput): bigint {
  if (input.member.userId === input.ownerId) return ALL_PERMISSIONS;

  const roleById = new Map(input.roles.map((r) => [r.id, r]));
  let perms = 0n;
  const everyone = roleById.get(input.guildId);
  if (everyone) perms |= BigInt(everyone.permissions);
  for (const roleId of input.member.roleIds) {
    const role = roleById.get(roleId);
    if (role) perms |= BigInt(role.permissions);
  }
  if ((perms & PermissionFlagsBits.Administrator) === PermissionFlagsBits.Administrator) {
    return ALL_PERMISSIONS;
  }

  const everyoneOverwrite = input.overwrites.find(
    (o) => o.type === OverwriteType.Role && o.id === input.guildId,
  );
  if (everyoneOverwrite) {
    perms &= ~BigInt(everyoneOverwrite.deny);
    perms |= BigInt(everyoneOverwrite.allow);
  }

  let roleAllow = 0n;
  let roleDeny = 0n;
  const memberRoles = new Set(input.member.roleIds);
  for (const o of input.overwrites) {
    if (o.type === OverwriteType.Role && o.id !== input.guildId && memberRoles.has(o.id)) {
      roleAllow |= BigInt(o.allow);
      roleDeny |= BigInt(o.deny);
    }
  }
  perms &= ~roleDeny;
  perms |= roleAllow;

  const memberOverwrite = input.overwrites.find(
    (o) => o.type === OverwriteType.Member && o.id === input.member.userId,
  );
  if (memberOverwrite) {
    perms &= ~BigInt(memberOverwrite.deny);
    perms |= BigInt(memberOverwrite.allow);
  }

  return perms;
}

export function hasPermission(perms: bigint, flag: bigint): boolean {
  return (perms & flag) === flag;
}

export function hasAllPermissions(perms: bigint, flags: bigint[]): boolean {
  return flags.every((f) => hasPermission(perms, f));
}
