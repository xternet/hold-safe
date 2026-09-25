import type { MonitorPort } from "../_kernel/mod";
import { FeedMonitor, type FeedOptions } from "./_0_cache/mod";
export function createFeedMonitor(options: FeedOptions): MonitorPort { return new FeedMonitor(options); }
