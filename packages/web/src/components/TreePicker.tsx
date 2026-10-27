import { useEffect, useId, useRef, useState } from 'react';
import type { RoleDto, TeamChannelDto, TeamDto } from '@discrello/shared';

export interface TreeItem {
  value: string;
  label: string;
  hint?: string;
}

/** A folder of choices that expands and collapses, like a folder in a file explorer. */
export interface TreeFolder {
  key: string;
  label: string;
  hint?: string;
  items: TreeItem[];
}

/**
 * A dropdown whose choices are grouped in folders that expand and collapse, so a long list of
 * teams and people stays short. The folder holding the current choice opens by itself, and
 * typing in the filter shows every match with its folder open.
 */
export function TreePicker({
  value,
  onChange,
  topItems = [],
  folders,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Choices shown above the folders, e.g. "— No notification —". */
  topItems?: TreeItem[];
  folders: TreeFolder[];
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const ref = useRef<HTMLDivElement>(null);
  const panelId = useId();

  const all = [...topItems, ...folders.flatMap((f) => f.items)];
  const selected = all.find((i) => i.value === value) ?? null;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggleOpen = () => {
    if (!open) {
      // Open on the current choice: its folder is expanded, the others are collapsed.
      const home = folders.find((f) => f.items.some((i) => i.value === value));
      setExpanded(new Set(home ? [home.key] : []));
      setFilter('');
    }
    setOpen((o) => !o);
  };
  const toggleFolder = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
  };

  const q = filter.trim().toLowerCase();
  const matches = (i: TreeItem) => !q || i.label.toLowerCase().includes(q);
  const visibleFolders = folders
    .map((f) => ({
      ...f,
      shown: q && f.label.toLowerCase().includes(q) ? f.items : f.items.filter(matches),
    }))
    .filter((f) => !q || f.shown.length > 0);

  const option = (i: TreeItem, indent: boolean) => {
    const isSelected = i.value === value;
    return (
      <button
        key={i.value}
        type="button"
        role="option"
        aria-selected={isSelected}
        onClick={() => pick(i.value)}
        className={`flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left text-sm ${indent ? 'pl-7' : ''} ${isSelected ? 'bg-indigo-50 font-medium text-indigo-800' : 'text-gray-800 hover:bg-gray-100'}`}
      >
        <span className="truncate">{i.label}</span>
        {i.hint && <span className="shrink-0 text-xs text-gray-500">{i.hint}</span>}
      </button>
    );
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={toggleOpen}
        className="flex w-full items-center justify-between gap-2 rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-left text-sm text-gray-900 shadow-xs focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 focus:outline-none"
      >
        <span className="truncate">{selected?.label ?? 'Choose…'}</span>
        <span className="text-xs text-gray-500">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div
          id={panelId}
          role="listbox"
          className="absolute right-0 z-30 mt-1 max-h-96 w-full min-w-[18rem] overflow-y-auto rounded-md border border-gray-200 bg-white p-1.5 shadow-lg"
        >
          <input
            autoFocus
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter…"
            className="mb-1 w-full rounded border border-gray-200 px-2 py-1 text-sm focus:border-indigo-400 focus:outline-none"
          />
          {topItems.filter(matches).map((i) => option(i, false))}
          {visibleFolders.map((f) => {
            const isOpen = Boolean(q) || expanded.has(f.key);
            return (
              <div key={f.key}>
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => toggleFolder(f.key)}
                  className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-sm font-semibold text-gray-700 hover:bg-gray-100"
                >
                  <span className="w-3 text-xs text-gray-500">{isOpen ? '▾' : '▸'}</span>
                  <span className="truncate">{f.label}</span>
                  {f.hint && <span className="text-xs font-normal text-gray-500">{f.hint}</span>}
                </button>
                {isOpen &&
                  (f.shown.length ? (
                    <div className="ml-3.5 border-l border-gray-200">
                      {f.shown.map((i) => option(i, true))}
                    </div>
                  ) : (
                    <p className="py-1 pl-9 text-xs text-gray-400">Empty</p>
                  ))}
              </div>
            );
          })}
          {q && visibleFolders.length === 0 && topItems.filter(matches).length === 0 && (
            <p className="px-2 py-1 text-xs text-gray-500">Nothing matches "{filter}".</p>
          )}
        </div>
      )}
    </div>
  );
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The folders for choosing who is pinged: one per channel with its teams, one for teams without a
 * channel, and one with every person (role). Values are `team:<id>` and `role:<id>`.
 */
export function recipientFolders(
  roles: RoleDto[],
  teams: TeamDto[],
  channels: TeamChannelDto[],
): TreeFolder[] {
  const teamItem = (t: TeamDto): TreeItem => ({
    value: `team:${t.id}`,
    label: t.name,
    hint: plural(t.members.length, 'person', 'people'),
  });
  const folders: TreeFolder[] = channels.map((c) => {
    const inside = teams.filter((t) => t.channelId === c.id);
    return {
      key: `channel:${c.id}`,
      label: c.name,
      hint: plural(inside.length, 'team', 'teams'),
      items: inside.map(teamItem),
    };
  });
  const loose = teams.filter((t) => !channels.some((c) => c.id === t.channelId));
  if (loose.length) {
    folders.push({
      key: 'channel:none',
      label: channels.length ? 'Teams without a channel' : 'Teams',
      hint: plural(loose.length, 'team', 'teams'),
      items: loose.map(teamItem),
    });
  }
  folders.push({
    key: 'people',
    label: 'People',
    hint: plural(roles.length, 'role', 'roles'),
    items: roles.map((r) => ({ value: `role:${r.id}`, label: r.displayName })),
  });
  return folders;
}
