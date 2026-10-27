import type { ConnectionStatus } from '../lib/socket';

/**
 * One line, only when it matters. A party game hides its own engineering: if the
 * socket is fine, this renders nothing, because a permanently visible "Connected"
 * badge is noise that trains players to ignore the strip entirely.
 */
export function ConnectionBanner({ status }: { status: ConnectionStatus }) {
  if (status === 'open' || status === 'idle' || status === 'connecting') return null;

  const copy =
    status === 'reconnecting'
      ? 'Reconnecting…'
      : status === 'closed'
        ? 'Disconnected'
        : 'Connection problem';

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 top-0 z-40 border-b border-brass-600/30 bg-ink-850/95 px-4 py-1.5 text-center text-xs font-medium tracking-wide text-brass-300 backdrop-blur"
    >
      {copy}
      {status === 'reconnecting' ? ' hold tight' : ''}
    </div>
  );
}
