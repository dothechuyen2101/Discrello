import { formatDateTime, relativeTime } from '../lib/format';

export function RelativeTime({ iso }: { iso: string | null | undefined }) {
  if (!iso) return <span className="text-gray-400">—</span>;
  return (
    <time dateTime={iso} title={formatDateTime(iso)} className="whitespace-nowrap">
      {relativeTime(iso)}
    </time>
  );
}
