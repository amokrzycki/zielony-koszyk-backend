import { ChildProcess, fork } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  CLIENTS,
  HarnessError,
  MAX_MEMORY_SAMPLE_GAP_MS,
  MEMORY_SAMPLE_INTERVAL_MS,
} from './protocol';

export const parseCpuUsageUsec = (text: string) => {
  const match = /^usage_usec\s+(\d+)$/m.exec(text);
  const value = match ? Number(match[1]) : Number.NaN;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new HarnessError('CGROUP_CPU_PARSE');
  }
  return value;
};

export const parseMemoryCurrent = (text: string) => {
  const value = Number(text.trim());
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new HarnessError('CGROUP_MEMORY_PARSE');
  }
  return value;
};

export const calculateResourceMetrics = (
  cpuBefore: number,
  cpuAfter: number,
  memorySamples: number[],
  requestCount: number,
) => {
  if (
    requestCount !== CLIENTS ||
    !Number.isSafeInteger(cpuBefore) ||
    !Number.isSafeInteger(cpuAfter) ||
    cpuAfter < cpuBefore ||
    memorySamples.length < 2 ||
    memorySamples.some((sample) => !Number.isSafeInteger(sample) || sample < 0)
  ) {
    throw new HarnessError('RESOURCE_METRICS_INVALID');
  }
  const cpuDelta = cpuAfter - cpuBefore;
  const baseline = memorySamples[0];
  const peak = Math.max(...memorySamples);
  return {
    cpu_usage_before_usec: cpuBefore,
    cpu_usage_after_usec: cpuAfter,
    cpu_delta_usec: cpuDelta,
    cpu_per_request_usec: cpuDelta / requestCount,
    memory_baseline_bytes: baseline,
    memory_peak_bytes: peak,
    memory_peak_delta_bytes: peak - baseline,
  };
};

type MonitorReaders = {
  cpu: () => number;
  memory: () => number;
  identity: () => string;
  monotonic: () => number;
  utc: () => string;
};

export type MemorySample = {
  timestamp_utc: string;
  memory_current_bytes: number;
  monotonic_ms: number;
};

export type ResourceSummary = ReturnType<typeof calculateResourceMetrics> & {
  cgroup_path: string;
  cgroup_id: string;
  cgroup_identity: string;
  memory_sample_interval_ms: number;
  memory_sample_count: number;
  final_sample_present: true;
  max_memory_sample_gap_ms: number;
  monitor_started_at_utc: string;
  monitor_stopped_at_utc: string;
  samples: MemorySample[];
};

export class CgroupMonitor {
  private phase: 'PREPARATION' | 'MONITORING' | 'STOPPED' | 'INVALID' =
    'PREPARATION';
  private timer?: NodeJS.Timeout;
  private samples: MemorySample[] = [];
  private cpuBefore?: number;
  private identityBefore?: string;
  private startedAt?: string;
  private readFailure = false;

  constructor(
    private readonly cgroupPath: string,
    private readonly cgroupId: string,
    private readonly readers: MonitorReaders = {
      cpu: () =>
        parseCpuUsageUsec(
          readFileSync(resolve(cgroupPath, 'cpu.stat'), 'utf8'),
        ),
      memory: () =>
        parseMemoryCurrent(
          readFileSync(resolve(cgroupPath, 'memory.current'), 'utf8'),
        ),
      identity: () => {
        const stat = statSync(cgroupPath);
        return `${stat.dev}:${stat.ino}`;
      },
      monotonic: () => performance.now(),
      utc: () => new Date().toISOString(),
    },
  ) {}

  assertPreparationAllowed() {
    if (this.phase !== 'PREPARATION') {
      throw new HarnessError('PREPARATION_AFTER_BASELINE');
    }
  }

  start(readyCount: number) {
    if (this.phase !== 'PREPARATION' || readyCount !== CLIENTS) {
      throw new HarnessError('MONITOR_START_BEFORE_READY');
    }
    try {
      this.identityBefore = this.readers.identity();
      this.cpuBefore = this.readers.cpu();
      this.startedAt = this.readers.utc();
      this.phase = 'MONITORING';
      this.sampleNow();
      if (this.readFailure || this.samples.length !== 1) {
        throw new HarnessError('RESOURCE_BASELINE_READ');
      }
      this.timer = setInterval(
        () => this.sampleNow(),
        MEMORY_SAMPLE_INTERVAL_MS,
      );
    } catch {
      this.invalidateTimer();
      this.phase = 'INVALID';
      throw new HarnessError('RESOURCE_BASELINE_READ');
    }
  }

  sampleNow() {
    if (this.phase !== 'MONITORING') return;
    try {
      this.samples.push({
        timestamp_utc: this.readers.utc(),
        memory_current_bytes: this.readers.memory(),
        monotonic_ms: this.readers.monotonic(),
      });
    } catch {
      this.readFailure = true;
    }
  }

  stop(completedResponses: number): ResourceSummary {
    if (this.phase !== 'MONITORING' || completedResponses !== CLIENTS) {
      this.invalidateTimer();
      throw new HarnessError('MONITOR_STOP_BEFORE_RESPONSES');
    }
    this.invalidateTimer();
    this.sampleNow();
    try {
      const stoppedAt = this.readers.utc();
      const cpuAfter = this.readers.cpu();
      if (
        this.readFailure ||
        !this.identityBefore ||
        this.readers.identity() !== this.identityBefore ||
        this.cpuBefore === undefined ||
        !this.startedAt ||
        this.samples.length < 2
      ) {
        throw new HarnessError('RESOURCE_MONITOR_INVALID');
      }
      const gaps = this.samples
        .slice(1)
        .map(
          (sample, index) =>
            sample.monotonic_ms - this.samples[index].monotonic_ms,
        );
      const maxGap = Math.max(0, ...gaps);
      if (gaps.some((gap) => gap < 0) || maxGap > MAX_MEMORY_SAMPLE_GAP_MS) {
        throw new HarnessError('RESOURCE_MEMORY_GAP');
      }
      const metrics = calculateResourceMetrics(
        this.cpuBefore,
        cpuAfter,
        this.samples.map(({ memory_current_bytes }) => memory_current_bytes),
        completedResponses,
      );
      this.phase = 'STOPPED';
      return {
        cgroup_path: this.cgroupPath,
        cgroup_id: this.cgroupId,
        cgroup_identity: this.identityBefore,
        memory_sample_interval_ms: MEMORY_SAMPLE_INTERVAL_MS,
        memory_sample_count: this.samples.length,
        final_sample_present: true,
        max_memory_sample_gap_ms: maxGap,
        monitor_started_at_utc: this.startedAt,
        monitor_stopped_at_utc: stoppedAt,
        samples: [...this.samples],
        ...metrics,
      };
    } catch (error) {
      this.phase = 'INVALID';
      if (error instanceof HarnessError) throw error;
      throw new HarnessError('RESOURCE_FINAL_READ');
    }
  }

  private invalidateTimer() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}

type WorkerRequest =
  | {
      type: 'START';
      cgroupPath: string;
      cgroupId: string;
      readyCount: number;
    }
  | { type: 'STOP'; completedResponses: number };

type WorkerResponse =
  | { type: 'STARTED' }
  | { type: 'STOPPED'; summary: ResourceSummary }
  | { type: 'ERROR'; code: string };

if (require.main === module && process.argv.includes('--worker')) {
  let monitor: CgroupMonitor | undefined;
  process.on('message', (message: WorkerRequest) => {
    try {
      if (message.type === 'START') {
        if (monitor) throw new HarnessError('MONITOR_DUPLICATE_START');
        monitor = new CgroupMonitor(message.cgroupPath, message.cgroupId);
        monitor.start(message.readyCount);
        process.send?.({ type: 'STARTED' } satisfies WorkerResponse);
        return;
      }
      if (!monitor) throw new HarnessError('MONITOR_NOT_STARTED');
      const summary = monitor.stop(message.completedResponses);
      process.send?.({ type: 'STOPPED', summary } satisfies WorkerResponse);
    } catch (error) {
      process.send?.({
        type: 'ERROR',
        code:
          error instanceof HarnessError
            ? error.code
            : 'RESOURCE_MONITOR_INVALID',
      } satisfies WorkerResponse);
    }
  });
}

export class ResourceMonitorProcess {
  private child?: ChildProcess;

  async start(cgroupPath: string, cgroupId: string, readyCount: number) {
    if (this.child) throw new HarnessError('MONITOR_DUPLICATE_START');
    this.child = fork(__filename, ['--worker'], {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      execArgv: process.execArgv,
    });
    const response = this.nextMessage();
    this.child.send({ type: 'START', cgroupPath, cgroupId, readyCount });
    const message = await response;
    if (message.type === 'ERROR') throw new HarnessError(message.code);
    if (message.type !== 'STARTED') throw new HarnessError('MONITOR_PROTOCOL');
  }

  async stop(completedResponses: number) {
    if (!this.child) throw new HarnessError('MONITOR_NOT_STARTED');
    const response = this.nextMessage();
    this.child.send({ type: 'STOP', completedResponses });
    const message = await response;
    if (message.type === 'ERROR') throw new HarnessError(message.code);
    if (message.type !== 'STOPPED') throw new HarnessError('MONITOR_PROTOCOL');
    await this.close();
    return message.summary;
  }

  async close() {
    const child = this.child;
    this.child = undefined;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    child.kill('SIGTERM');
    await new Promise<void>((resolve) => child.once('exit', () => resolve()));
  }

  private nextMessage() {
    return new Promise<WorkerResponse>((resolve, reject) => {
      const child = this.child;
      if (!child) return reject(new HarnessError('MONITOR_NOT_STARTED'));
      const onMessage = (message: WorkerResponse) => {
        cleanup();
        resolve(message);
      };
      const onExit = () => {
        cleanup();
        reject(new HarnessError('MONITOR_PROCESS_EXIT'));
      };
      const cleanup = () => {
        child.off('message', onMessage);
        child.off('exit', onExit);
      };
      child.once('message', onMessage);
      child.once('exit', onExit);
    });
  }
}
