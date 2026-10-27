import type { FastifyBaseLogger } from 'fastify';

interface Job {
  name: string;
  timer: NodeJS.Timeout;
  running: boolean;
}

/** Tiny interval scheduler with an overlap guard per job. */
export class Scheduler {
  private readonly jobs: Job[] = [];

  constructor(private readonly logger: FastifyBaseLogger) {}

  every(
    name: string,
    intervalMs: number,
    fn: () => Promise<void>,
    opts: { runNow?: boolean } = {},
  ): void {
    const job: Job = { name, running: false, timer: null as unknown as NodeJS.Timeout };
    const tick = async () => {
      if (job.running) return;
      job.running = true;
      const started = Date.now();
      try {
        await fn();
        this.logger.debug({ job: name, ms: Date.now() - started }, 'job finished');
      } catch (err) {
        this.logger.error({ err, job: name }, 'job failed');
      } finally {
        job.running = false;
      }
    };
    job.timer = setInterval(() => void tick(), intervalMs);
    job.timer.unref();
    this.jobs.push(job);
    if (opts.runNow) void tick();
  }

  stop(): void {
    for (const job of this.jobs) clearInterval(job.timer);
    this.jobs.length = 0;
  }
}
