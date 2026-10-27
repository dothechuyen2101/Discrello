import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  BoardCreateInput,
  BoardDetailDto,
  BoardPatchInput,
  BoardPreviewDto,
  BoardSummaryDto,
  BotGuildDto,
  DiscordChannelDto,
  DiscordRoleDto,
  GuildCreateInput,
  GuildDto,
  GuildPatchInput,
  IntegrationsHealthDto,
  MappingPutInput,
  ListMappingDto,
  NotificationDto,
  NotificationStatus,
  PageDto,
  RoleCreateInput,
  RoleDto,
  RolePatchInput,
  SettingsDto,
  TeamChannelDto,
  TeamChannelInput,
  TeamCreateInput,
  TeamDto,
  TeamPatchInput,
  TestSendResultDto,
  WebhookEventDto,
  MentionTarget,
} from '@discrello/shared';
import { apiFetch, qs } from './client';

export const keys = {
  me: ['me'] as const,
  integrations: ['integrations'] as const,
  guilds: ['guilds'] as const,
  botGuilds: ['bot-guilds'] as const,
  guildChannels: (id: number | null) => ['guild-channels', id] as const,
  guildRoles: (id: number | null) => ['guild-roles', id] as const,
  roles: ['roles'] as const,
  teams: ['teams'] as const,
  teamChannels: ['team-channels'] as const,
  boards: ['boards'] as const,
  board: (id: number) => ['board', id] as const,
  notifications: (f: NotificationFilters) => ['notifications', f] as const,
  webhookEvents: (f: WebhookEventFilters) => ['webhook-events', f] as const,
  settings: ['settings'] as const,
};

// ---- auth ----
export function useMe() {
  return useQuery({
    queryKey: keys.me,
    queryFn: () =>
      apiFetch<{ authenticated: boolean }>('GET', '/api/auth/me', undefined, {
        skipAuthRedirect: true,
      }),
    retry: false,
    staleTime: 60_000,
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (password: string) =>
      apiFetch<{ authenticated: boolean }>(
        'POST',
        '/api/auth/login',
        { password },
        { skipAuthRedirect: true },
      ),
    onSuccess: (data) => {
      qc.setQueryData(keys.me, data);
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<{ authenticated: boolean }>('POST', '/api/auth/logout'),
    onSettled: () => {
      qc.clear();
    },
  });
}

// ---- health ----
export function useIntegrations(opts: { refetchInterval?: number } = {}) {
  return useQuery({
    queryKey: keys.integrations,
    queryFn: () => apiFetch<IntegrationsHealthDto>('GET', '/api/health/integrations'),
    refetchInterval: opts.refetchInterval ?? 60_000,
    staleTime: 30_000,
  });
}

// ---- guilds ----
export function useGuilds() {
  return useQuery({
    queryKey: keys.guilds,
    queryFn: () => apiFetch<GuildDto[]>('GET', '/api/guilds'),
  });
}

export function useBotGuilds(enabled: boolean) {
  return useQuery({
    queryKey: keys.botGuilds,
    queryFn: () => apiFetch<BotGuildDto[]>('GET', '/api/discord/bot-guilds'),
    enabled,
  });
}

export function useGuildChannels(guildId: number | null) {
  return useQuery({
    queryKey: keys.guildChannels(guildId),
    queryFn: () => apiFetch<DiscordChannelDto[]>('GET', `/api/guilds/${guildId}/channels`),
    enabled: guildId !== null,
    staleTime: 60_000,
  });
}

export function useGuildRoles(guildId: number | null) {
  return useQuery({
    queryKey: keys.guildRoles(guildId),
    queryFn: () => apiFetch<DiscordRoleDto[]>('GET', `/api/guilds/${guildId}/roles`),
    enabled: guildId !== null,
    staleTime: 60_000,
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  return (...groups: Array<readonly unknown[]>) =>
    Promise.all(groups.map((g) => qc.invalidateQueries({ queryKey: g })));
}

export function useAddGuild() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (input: GuildCreateInput) => apiFetch<GuildDto>('POST', '/api/guilds', input),
    onSuccess: () => inv(keys.guilds, keys.botGuilds, keys.integrations),
  });
}

export function usePatchGuild() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: GuildPatchInput }) =>
      apiFetch<GuildDto>('PATCH', `/api/guilds/${id}`, input),
    onSuccess: () => inv(keys.guilds),
  });
}

export function useDeleteGuild() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (id: number) => apiFetch<void>('DELETE', `/api/guilds/${id}`),
    onSuccess: () => inv(keys.guilds, keys.botGuilds, keys.roles, keys.integrations),
  });
}

export function useCheckGuild() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (id: number) => apiFetch<GuildDto>('POST', `/api/guilds/${id}/check`),
    onSuccess: () => inv(keys.guilds),
  });
}

// ---- roles ----
export function useRoles() {
  return useQuery({
    queryKey: keys.roles,
    queryFn: () => apiFetch<RoleDto[]>('GET', '/api/roles'),
  });
}

export function useCreateRole() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (input: RoleCreateInput) => apiFetch<RoleDto>('POST', '/api/roles', input),
    onSuccess: () => inv(keys.roles),
  });
}

export function useUpdateRole() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: RolePatchInput }) =>
      apiFetch<RoleDto>('PUT', `/api/roles/${id}`, input),
    onSuccess: () => inv(keys.roles, keys.teams, keys.boards, ['board']),
  });
}

export function useDeleteRole() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (id: number) => apiFetch<void>('DELETE', `/api/roles/${id}`),
    onSuccess: () => inv(keys.roles, keys.teams),
  });
}

export function usePutRoleTarget() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: ({
      roleId,
      guildId,
      target,
    }: {
      roleId: number;
      guildId: number;
      target: MentionTarget;
    }) => apiFetch<RoleDto>('PUT', `/api/roles/${roleId}/targets/${guildId}`, target),
    onSuccess: () => inv(keys.roles, keys.boards, ['board']),
  });
}

export function useDeleteRoleTarget() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: ({ roleId, guildId }: { roleId: number; guildId: number }) =>
      apiFetch<RoleDto>('DELETE', `/api/roles/${roleId}/targets/${guildId}`),
    onSuccess: () => inv(keys.roles, keys.boards, ['board']),
  });
}

export function useTestRoleTarget() {
  return useMutation({
    mutationFn: ({
      roleId,
      guildId,
      channelId,
    }: {
      roleId: number;
      guildId: number;
      channelId: string;
    }) =>
      apiFetch<TestSendResultDto>('POST', `/api/roles/${roleId}/targets/${guildId}/test`, {
        channelId,
      }),
  });
}

// ---- teams ----
export function useTeams() {
  return useQuery({
    queryKey: keys.teams,
    queryFn: () => apiFetch<TeamDto[]>('GET', '/api/teams'),
  });
}

export function useCreateTeam() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (input: TeamCreateInput) => apiFetch<TeamDto>('POST', '/api/teams', input),
    onSuccess: () => inv(keys.teams, keys.roles, keys.teamChannels),
  });
}

export function useUpdateTeam() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: TeamPatchInput }) =>
      apiFetch<TeamDto>('PUT', `/api/teams/${id}`, input),
    onSuccess: () => inv(keys.teams, keys.roles, keys.teamChannels, ['board']),
  });
}

export function useDeleteTeam() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (id: number) => apiFetch<void>('DELETE', `/api/teams/${id}`),
    onSuccess: () => inv(keys.teams, keys.roles, keys.teamChannels),
  });
}

// ---- channels: folders of teams ----
export function useTeamChannels() {
  return useQuery({
    queryKey: keys.teamChannels,
    queryFn: () => apiFetch<TeamChannelDto[]>('GET', '/api/team-channels'),
  });
}
export function useCreateTeamChannel() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (input: TeamChannelInput) =>
      apiFetch<TeamChannelDto>('POST', '/api/team-channels', input),
    onSuccess: () => inv(keys.teamChannels),
  });
}
export function useRenameTeamChannel() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: TeamChannelInput }) =>
      apiFetch<TeamChannelDto>('PUT', `/api/team-channels/${id}`, input),
    onSuccess: () => inv(keys.teamChannels),
  });
}
export function useDeleteTeamChannel() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (id: number) => apiFetch<void>('DELETE', `/api/team-channels/${id}`),
    onSuccess: () => inv(keys.teamChannels, keys.teams),
  });
}

export function useAddTeamMember() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: ({ teamId, roleId }: { teamId: number; roleId: number }) =>
      apiFetch<TeamDto>('PUT', `/api/teams/${teamId}/members/${roleId}`),
    onSuccess: () => inv(keys.teams, keys.roles, keys.boards, ['board']),
  });
}

export function useRemoveTeamMember() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: ({ teamId, roleId }: { teamId: number; roleId: number }) =>
      apiFetch<TeamDto>('DELETE', `/api/teams/${teamId}/members/${roleId}`),
    onSuccess: () => inv(keys.teams, keys.roles, keys.boards, ['board']),
  });
}

// ---- boards ----
export function useBoards() {
  return useQuery({
    queryKey: keys.boards,
    queryFn: () => apiFetch<BoardSummaryDto[]>('GET', '/api/boards'),
    refetchInterval: 30_000,
  });
}

export function useBoard(id: number) {
  return useQuery({
    queryKey: keys.board(id),
    queryFn: () => apiFetch<BoardDetailDto>('GET', `/api/boards/${id}`),
  });
}

export function usePreviewBoard() {
  return useMutation({
    mutationFn: (ref: string) =>
      apiFetch<BoardPreviewDto>('POST', '/api/trello/boards/preview', { ref }),
  });
}

export function useCreateBoard() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (input: BoardCreateInput) => apiFetch<BoardDetailDto>('POST', '/api/boards', input),
    onSuccess: () => inv(keys.boards, keys.guilds),
  });
}

function useBoardAction<TVars, TResult = BoardDetailDto>(
  fn: (vars: TVars) => Promise<TResult>,
  extra: Array<readonly unknown[]> = [],
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async (data) => {
      const detail = data as unknown as BoardDetailDto | undefined;
      if (detail && typeof detail === 'object' && 'id' in detail)
        qc.setQueryData(keys.board(detail.id), detail);
      await Promise.all([
        qc.invalidateQueries({ queryKey: keys.boards }),
        ...extra.map((k) => qc.invalidateQueries({ queryKey: k })),
      ]);
    },
  });
}

export function usePatchBoard() {
  return useBoardAction(({ id, input }: { id: number; input: BoardPatchInput }) =>
    apiFetch<BoardDetailDto>('PATCH', `/api/boards/${id}`, input),
  );
}

export function useDeleteBoard() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (id: number) => apiFetch<void>('DELETE', `/api/boards/${id}`),
    onSuccess: () => inv(keys.boards, keys.guilds, keys.roles),
  });
}

export function useSyncLists() {
  return useBoardAction((id: number) =>
    apiFetch<BoardDetailDto>('POST', `/api/boards/${id}/sync-lists`),
  );
}

export function useCheckWebhook() {
  return useBoardAction((id: number) =>
    apiFetch<BoardDetailDto>('POST', `/api/boards/${id}/webhook/check`),
  );
}

export function useRegisterWebhook() {
  return useBoardAction((id: number) =>
    apiFetch<BoardDetailDto>('POST', `/api/boards/${id}/webhook/register`),
  );
}

export function usePutMapping(boardId: number) {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: ({ trelloListId, input }: { trelloListId: string; input: MappingPutInput }) =>
      apiFetch<ListMappingDto>('PUT', `/api/boards/${boardId}/mappings/${trelloListId}`, input),
    onSuccess: () => inv(keys.board(boardId), keys.boards, keys.roles, keys.teams),
  });
}

export function useDeleteMapping(boardId: number) {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (trelloListId: string) =>
      apiFetch<void>('DELETE', `/api/boards/${boardId}/mappings/${trelloListId}`),
    onSuccess: () => inv(keys.board(boardId), keys.boards, keys.roles, keys.teams),
  });
}

export function useTestMapping(boardId: number) {
  return useMutation({
    mutationFn: (trelloListId: string) =>
      apiFetch<TestSendResultDto>('POST', `/api/boards/${boardId}/mappings/${trelloListId}/test`),
  });
}

// ---- notifications ----
export interface NotificationFilters {
  guildId?: number;
  boardId?: number;
  status?: NotificationStatus;
}

export function useNotifications(filters: NotificationFilters) {
  return useInfiniteQuery({
    queryKey: keys.notifications(filters),
    queryFn: ({ pageParam }) =>
      apiFetch<PageDto<NotificationDto>>(
        'GET',
        `/api/notifications${qs({ ...filters, limit: 50, before: pageParam })}`,
      ),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => last.nextBefore ?? undefined,
    refetchInterval: 10_000,
  });
}

export function useRetryNotification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiFetch<NotificationDto>('POST', `/api/notifications/${id}/retry`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
}

export interface WebhookEventFilters {
  boardId?: number;
  outcome?: 'enqueued' | 'ignored';
}

export function useWebhookEvents(filters: WebhookEventFilters) {
  return useInfiniteQuery({
    queryKey: keys.webhookEvents(filters),
    queryFn: ({ pageParam }) =>
      apiFetch<PageDto<WebhookEventDto>>(
        'GET',
        `/api/webhook-events${qs({ ...filters, limit: 50, before: pageParam })}`,
      ),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => last.nextBefore ?? undefined,
    refetchInterval: 10_000,
  });
}

// ---- settings / admin ----
export function useSettings() {
  return useQuery({
    queryKey: keys.settings,
    queryFn: () => apiFetch<SettingsDto>('GET', '/api/settings'),
    staleTime: 60_000,
  });
}

export function useSaveSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<SettingsDto>) =>
      apiFetch<SettingsDto>('PUT', '/api/settings', input),
    onSuccess: (data) => qc.setQueryData(keys.settings, data),
  });
}

export interface ReconcileResult {
  checked: number;
  orphansDeleted: number;
}
export interface RecheckResult {
  targetsChecked: number;
  targetsFailing: number;
  mappingsChecked: number;
  mappingsFailing: number;
}

export function useReconcile() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: () => apiFetch<ReconcileResult>('POST', '/api/admin/reconcile'),
    onSuccess: () => inv(keys.boards, ['board']),
  });
}

export function useRecheckMentions() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: () => apiFetch<RecheckResult>('POST', '/api/admin/recheck-mentions'),
    onSuccess: () => inv(keys.roles, keys.boards, ['board']),
  });
}
