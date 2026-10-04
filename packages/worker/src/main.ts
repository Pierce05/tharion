import { createWorker } from './worker';

const id = process.env.WORKER_ID ?? `w-${process.pid}`;

const worker = createWorker({
  workerId: id,
  pollMs: Number(process.env.POLL_MS ?? 500),
  // Real fault: SIGKILL ourselves between the effect and the event commit. Busy-wait until the kernel lands it.
  crash: () => {
    process.kill(process.pid, 'SIGKILL');
    for (;;) {
      /* never returns */
    }
  },
  log: (m) => console.log(`[${id}] ${m}`),
});

worker.start();
console.log(`[${id}] up pid=${process.pid}`);

process.on('unhandledRejection', (e) => console.error(`[${id}] unhandledRejection`, e));
const shutdown = (): void => {
  void worker.stop().finally(() => process.exit(0));
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);