import { createClient } from '@supabase/supabase-js';
import { config } from './config.js';
import { logger } from './logger.js';

/**
 * Subscribes to the 'sheet_jobs' broadcast topic (see the migration's
 * acc.sheet_job_ping trigger) and calls onPing() whenever a job becomes pending.
 * This is purely a latency shortcut -- job-processor.js's own poll timer is what
 * actually guarantees jobs get picked up, so a missed or dropped Realtime message
 * here is not a correctness problem, just a slower one.
 */
export function startRealtimeListener(onPing) {
  const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);

  const channel = supabase
    .channel('sheet_jobs', { config: { broadcast: { self: false } } })
    .on('broadcast', { event: 'sheet_job_pending' }, ({ payload }) => {
      logger.info('realtime-listener: got a pending-job ping', payload);
      onPing();
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') logger.info('realtime-listener: subscribed to sheet_jobs broadcasts');
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        logger.warn('realtime-listener: channel not healthy, relying on poll timer until it recovers', { status });
      }
    });

  return () => supabase.removeChannel(channel);
}
