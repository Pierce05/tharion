import { AnimatePresence, motion } from 'framer-motion';
import { lastRecovery, type RunEvent } from '@tharion/engine';
import { useNow } from '../lib/useNow';
import { useSystem } from '../store/system';

export function RecoveryBanner({ runId, events, terminal }: { runId: string; events: RunEvent[]; terminal: boolean }) {
  const sys = useSystem((s) => s.sys);
  const fetchedAt = useSystem((s) => s.fetchedAt);
  const now = useNow(100);

  const sup = sys?.supervisor ?? null;
  const lease = sys?.leases.find((l) => l.runId === runId);
  const rec = lastRecovery(events);

  let banner: { key: string; color: string; text: string } | null = null;
  if (rec && now - rec.ts < 8000) {
    banner = { key: `rec-${rec.seq}`, color: 'var(--cyan)', text: `Worker lost · lease expired · run resumed on ${rec.workerId}` };
  } else if (sup && !sup.alive && !terminal && lease) {
    const rem = Math.max(0, lease.remainingMs - (now - fetchedAt));
    banner = {
      key: 'lost',
      color: rem > 0 ? 'var(--bad)' : 'var(--amber)',
      text: rem > 0 ? `Worker ${lease.owner} lost · lease expires in ${(rem / 1000).toFixed(1)}s` : 'Lease expired · waiting for a worker. Press START WORKER.',
    };
  }

  return (
    <div className="banner-wrap" aria-live="polite">
      <AnimatePresence mode="wait">
        {banner && (
          <motion.div key={banner.key} className="glass banner" style={{ borderColor: banner.color }} initial={{ y: -30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -30, opacity: 0 }}>
            {banner.text}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}