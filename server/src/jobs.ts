import { v4 as uuidv4 } from 'uuid';
import type { JobState, JobLog } from './types.js';

const jobs = new Map<string, JobState>();
const listeners = new Map<string, Set<(job: JobState) => void>>();

export function createJob(type: string): JobState {
  const job: JobState = {
    id: uuidv4(),
    type,
    status: 'pending',
    progress: 0,
    message: 'Starting...',
    logs: [],
  };
  jobs.set(job.id, job);
  return job;
}

export function getJob(id: string): JobState | undefined {
  return jobs.get(id);
}

export function subscribeJob(id: string, cb: (job: JobState) => void): () => void {
  if (!listeners.has(id)) listeners.set(id, new Set());
  listeners.get(id)!.add(cb);
  return () => listeners.get(id)?.delete(cb);
}

function emit(job: JobState) {
  listeners.get(job.id)?.forEach((cb) => cb({ ...job, logs: [...job.logs] }));
}

export function updateJob(id: string, patch: Partial<JobState>) {
  const job = jobs.get(id);
  if (!job) return;
  Object.assign(job, patch);
  emit(job);
}

export function appendLog(id: string, level: JobLog['level'], message: string) {
  const job = jobs.get(id);
  if (!job) return;
  job.logs.push({ time: new Date().toISOString(), level, message });
  emit(job);
}

export function jobEmitter(jobId: string) {
  return {
    log: (level: JobLog['level'], message: string) => appendLog(jobId, level, message),
    progress: (percent: number, message?: string) => {
      updateJob(jobId, { progress: Math.min(100, Math.max(0, percent)), ...(message && { message }) });
    },
  };
}

export function completeJob(id: string, result?: unknown) {
  updateJob(id, { status: 'completed', progress: 100, message: 'Completed', result });
}

export function failJob(id: string, error: string) {
  appendLog(id, 'error', error);
  updateJob(id, { status: 'failed', message: error, error });
}

// Cleanup old jobs after 1 hour
setInterval(() => {
  const cutoff = Date.now() - 3600000;
  for (const [id, job] of jobs) {
    const last = job.logs[job.logs.length - 1];
    if (last && new Date(last.time).getTime() < cutoff) jobs.delete(id);
  }
}, 600000);
