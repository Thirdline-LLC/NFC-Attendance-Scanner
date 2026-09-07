import { Link } from 'react-router-dom';
import { RadioTower } from 'lucide-react';

/**
 * Says out loud that taps are going nowhere while this page is open.
 *
 * The reader is a keyboard wedge: it types into whatever has focus, and on the
 * admin pages that is usually nothing at all, so a card tapped at the desk is
 * swallowed in silence. On the scanner screen a whole card is devoted to
 * telling the operator that a tap was read; here the only honest thing to do
 * is admit the opposite, because the alternative is a student walking away
 * believing they are checked in.
 */
export function ScansPausedNotice() {
  return (
    <p
      className="station-enter mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/.5)] px-3 py-2.5 text-xs leading-5 text-[hsl(var(--muted-foreground))]"
      role="status"
      data-testid="text-scans-paused"
    >
      <RadioTower
        aria-hidden="true"
        size={14}
        className="shrink-0 text-[hsl(var(--muted-foreground))]"
      />
      <span>
        Cards are <strong className="font-semibold">not</strong> being recorded
        while this page is open.
      </span>
      <Link
        to="/"
        className="font-semibold text-[hsl(var(--primary))] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
        data-testid="link-scanner-resume"
      >
        Back to the scanner to check students in
      </Link>
    </p>
  );
}
