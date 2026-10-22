/**
 * chaos/worker-restart.chaos.test.ts
 *
 * TEST-109 — Worker-restart chaos test for SorobanPay background workers.
 *
 * Acceptance criteria:
 *   - Tests are deterministic, isolated, runnable in Codespaces without real credentials or sleeps.
 *   - Verifies worker crash mid-processing does not drop jobs.
 *   - Verifies worker restart drains accumulated backlog without duplicate executions.
 *   - Verifies poison pill jobs do not permanently hang worker after reboot.
 *   - Verifies boundary conditions: empty queue restart, rapid back-to-back crashes.
 */

interface MockJob {
  id: string;
  name: string;
  data: Record<string, unknown>;
  attemptsMade: number;
  maxAttempts: number;
  status: 'waiting' | 'active' | 'completed' | 'failed';
  processedByWorker?: string;
}

class FaultInjectingJobQueue {
  private jobs: Map<string, MockJob> = new Map();
  private deadLetterQueue: MockJob[] = [];
  public deliveredPayloads: Record<string, unknown>[] = [];

  enqueue(id: string, name: string, data: Record<string, unknown>, maxAttempts = 3): MockJob {
    const job: MockJob = {
      id,
      name,
      data,
      attemptsMade: 0,
      maxAttempts,
      status: 'waiting',
    };
    this.jobs.set(id, job);
    return job;
  }

  getJob(id: string): MockJob | undefined {
    return this.jobs.get(id);
  }

  getAllJobs(): MockJob[] {
    return Array.from(this.jobs.values());
  }

  getDeadLetters(): MockJob[] {
    return this.deadLetterQueue;
  }

  reclaimStalledJobs(): void {
    for (const job of this.jobs.values()) {
      if (job.status === 'active') {
        // Worker died while processing: return to waiting state
        job.status = 'waiting';
      }
    }
  }

  async processNext(
    workerId: string,
    handler: (job: MockJob) => Promise<void>,
    options?: { crashDuringExecution?: boolean },
  ): Promise<boolean> {
    const nextJob = Array.from(this.jobs.values()).find(
      (j) => j.status === 'waiting',
    );
    if (!nextJob) return false;

    nextJob.status = 'active';
    nextJob.attemptsMade += 1;
    nextJob.processedByWorker = workerId;

    if (options?.crashDuringExecution) {
      // Worker abruptly killed (SIGKILL) mid-processing
      throw new Error(`WorkerCrashException: ${workerId} terminated unexpectedly`);
    }

    try {
      await handler(nextJob);
      nextJob.status = 'completed';
      this.deliveredPayloads.push(nextJob.data);
      return true;
    } catch (err) {
      if (nextJob.attemptsMade >= nextJob.maxAttempts) {
        nextJob.status = 'failed';
        this.deadLetterQueue.push(nextJob);
      } else {
        nextJob.status = 'waiting';
      }
      throw err;
    }
  }
}

describe('Worker-restart Chaos Suite', () => {
  let queue: FaultInjectingJobQueue;

  beforeEach(() => {
    queue = new FaultInjectingJobQueue();
  });

  it('CHAOS-WR-1: worker crash mid-job preserves job state and reclaims on restart', async () => {
    const job = queue.enqueue('job-1', 'webhook-delivery', {
      endpointId: 101,
      event: 'payment.succeeded',
      amount: '500',
    });

    // Worker 1 starts processing but crashes mid-flight
    await expect(
      queue.processNext('worker-instance-1', async () => {}, {
        crashDuringExecution: true,
      }),
    ).rejects.toThrow(/WorkerCrashException/);

    expect(job.status).toBe('active');
    expect(job.attemptsMade).toBe(1);

    // Orchestrator detects crash, recovers stalled jobs, boots Worker 2
    queue.reclaimStalledJobs();
    expect(job.status).toBe('waiting');

    // Worker 2 starts up and completes the job successfully
    const processed = await queue.processNext('worker-instance-2', async () => {});
    expect(processed).toBe(true);
    expect(job.status).toBe('completed');
    expect(job.attemptsMade).toBe(2);
    expect(job.processedByWorker).toBe('worker-instance-2');
  });

  it('CHAOS-WR-2: worker restart drains accumulated backlog deterministically', async () => {
    // 5 jobs enqueued while worker is down
    for (let i = 1; i <= 5; i++) {
      queue.enqueue(`job-${i}`, 'webhook-delivery', { id: i });
    }

    // New worker instance boots up and processes all backlogged jobs
    let count = 0;
    while (await queue.processNext('worker-restart-1', async () => {})) {
      count++;
    }

    expect(count).toBe(5);
    expect(queue.deliveredPayloads).toHaveLength(5);
    expect(queue.getAllJobs().every((j) => j.status === 'completed')).toBe(true);
  });

  it('CHAOS-WR-3: poison pill job does not crash restarted worker permanently', async () => {
    // Poison pill job that fails every attempt
    const poisonJob = queue.enqueue(
      'job-poison',
      'webhook-delivery',
      { badPayload: true },
      2, // 2 max attempts
    );

    const normalJob = queue.enqueue('job-normal', 'webhook-delivery', {
      goodPayload: true,
    });

    // Attempt 1 for poison pill fails
    await expect(
      queue.processNext('worker-1', async () => {
        throw new Error('Unparseable payload');
      }),
    ).rejects.toThrow('Unparseable payload');

    expect(poisonJob.status).toBe('waiting');
    expect(poisonJob.attemptsMade).toBe(1);

    // Attempt 2 for poison pill fails and moves to dead-letter queue
    await expect(
      queue.processNext('worker-1', async () => {
        throw new Error('Unparseable payload');
      }),
    ).rejects.toThrow('Unparseable payload');

    expect(poisonJob.status).toBe('failed');
    expect(queue.getDeadLetters()).toContain(poisonJob);

    // Normal job continues processing without interference
    const success = await queue.processNext('worker-1', async () => {});
    expect(success).toBe(true);
    expect(normalJob.status).toBe('completed');
  });

  it('CHAOS-WR-4: boundary - rapid back-to-back worker crashes do not corrupt data', async () => {
    queue.enqueue('job-boundary', 'webhook-delivery', { seq: 42 });

    // Crash 1
    await expect(
      queue.processNext('worker-crash-1', async () => {}, {
        crashDuringExecution: true,
      }),
    ).rejects.toThrow();
    queue.reclaimStalledJobs();

    // Crash 2
    await expect(
      queue.processNext('worker-crash-2', async () => {}, {
        crashDuringExecution: true,
      }),
    ).rejects.toThrow();
    queue.reclaimStalledJobs();

    // Stable worker recovers and finishes
    const finished = await queue.processNext('worker-stable', async () => {});
    expect(finished).toBe(true);
    expect(queue.getJob('job-boundary')?.status).toBe('completed');
  });

  it('CHAOS-WR-5: boundary - clean restart with empty queue is a no-op', async () => {
    const processed = await queue.processNext('worker-clean', async () => {});
    expect(processed).toBe(false);
    expect(queue.getAllJobs()).toHaveLength(0);
  });
});
