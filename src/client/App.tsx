import { useEffect, useState } from 'react';
import { useSession } from './lib/session';
import { readRoute } from './lib/router';
import { Landing } from './screens/Landing';
import { Lobby } from './screens/Lobby';
import { Bidding } from './screens/Bidding';
import { Reveal } from './screens/Reveal';
import { Recap } from './screens/Recap';
import { ConnectionBanner } from './components/ConnectionBanner';

/**
 * Screen switcher. Exports components only — the routing helpers live in
 * `lib/router.ts` because a module that mixes component and plain-function
 * exports cannot Fast Refresh, and the dev loop depends on it.
 */
export function App() {
  const [route, setRoute] = useState(readRoute);
  const { view, status, error } = useSession();

  useEffect(() => {
    const onPop = () => setRoute(readRoute());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // A URL carrying a room code but no live socket means a direct link or a
  // reload we could not resume: show the join form pre-filled for that code
  // rather than silently dropping the visitor on the homepage.
  if (route.room !== null && view === null) {
    return <Landing initialCode={route.room} />;
  }

  if (!view) {
    return <Landing initialCode={null} />;
  }

  return (
    <div className="min-h-dvh bg-ink-950 text-parchment-50">
      <ConnectionBanner status={status} />
      {error ? <ErrorToast message={error} /> : null}
      {view.phase === 'lobby' ? (
        <Lobby view={view} />
      ) : view.phase === 'bidding' ? (
        <Bidding view={view} />
      ) : view.phase === 'reveal' ? (
        <Reveal view={view} />
      ) : (
        <Recap view={view} />
      )}
    </div>
  );
}

function ErrorToast({ message }: { message: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-3 z-50 flex justify-center px-4"
    >
      <p className="pointer-events-auto rounded-full border border-burnt-500/50 bg-burnt-600/95 px-4 py-2 text-sm font-medium text-parchment-50 shadow-lg">
        {message}
      </p>
    </div>
  );
}
