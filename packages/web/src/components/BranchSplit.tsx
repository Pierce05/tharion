import { useEffect } from 'react';
import { motion } from 'framer-motion';

export function BranchSplit({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 1300);
    return () => clearTimeout(t);
  }, [onDone]);
  const draw = { initial: { pathLength: 0, opacity: 0 }, animate: { pathLength: 1, opacity: 1 } };
  return (
    <div className="split" aria-hidden="true">
      <svg viewBox="0 0 400 120" width="420" height="126">
        <motion.path d="M20 60 H150" fill="none" stroke="#B4BBCB" strokeWidth="3" {...draw} transition={{ duration: 0.3 }} />
        <motion.path d="M150 60 C210 60 210 28 270 28 H380" fill="none" stroke="#4FD8FF" strokeWidth="3" {...draw} transition={{ duration: 0.5, delay: 0.25 }} />
        <motion.path d="M150 60 C210 60 210 92 270 92 H380" fill="none" stroke="#A78BFA" strokeWidth="3" {...draw} transition={{ duration: 0.5, delay: 0.3 }} />
      </svg>
      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 }} className="sg" style={{ fontSize: 16 }}>
        A new timeline begins
      </motion.div>
    </div>
  );
}