import { ExecutionWorker } from "./_3_worker/mod";
import type { WorkerOptions } from "./_shared/mod";
export function createWorker(options: WorkerOptions): ExecutionWorker { return new ExecutionWorker(options); }
