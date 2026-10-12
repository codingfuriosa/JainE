import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

fs.mkdirSync(config.logDir, { recursive: true });

function currentLogFile() {
  const day = new Date().toISOString().slice(0, 10); // one file per day, no external dep needed
  return path.join(config.logDir, `sheet-bot-${day}.log`);
}

function write(level, message, extra) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    message,
    ...(extra ? { extra } : {}),
  });
  fs.appendFileSync(currentLogFile(), line + '\n');
}

export const logger = {
  info: (message, extra) => write('info', message, extra),
  warn: (message, extra) => write('warn', message, extra),
  error: (message, extra) => write('error', message, extra),
  /** Saves a base64 CDP screenshot next to the log, named by job id, and logs its path. */
  saveScreenshot(jobId, base64Png) {
    const file = path.join(config.logDir, `job-${jobId}-${Date.now()}.png`);
    fs.writeFileSync(file, Buffer.from(base64Png, 'base64'));
    write('error', 'saved failure screenshot', { jobId, file });
    return file;
  },
};
