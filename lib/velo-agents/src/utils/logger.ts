const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
type Level = keyof typeof LEVELS;

const MIN_LEVEL: Level =
  (process.env.LOG_LEVEL as Level | undefined) ?? "info";

function timestamp(): string {
  return new Date().toISOString();
}

function log(level: Level, context: string, msg: string, data?: unknown): void {
  if (LEVELS[level] < LEVELS[MIN_LEVEL]) return;
  const prefix = `[${timestamp()}] [${level.toUpperCase().padEnd(5)}] [${context}]`;
  const line = data !== undefined
    ? `${prefix} ${msg} ${JSON.stringify(data)}`
    : `${prefix} ${msg}`;
  if (level === "error" || level === "warn") {
    process.stderr.write(line + "\n");
  } else {
    process.stdout.write(line + "\n");
  }
}

export function makeLogger(context: string) {
  return {
    debug: (msg: string, data?: unknown) => log("debug", context, msg, data),
    info:  (msg: string, data?: unknown) => log("info",  context, msg, data),
    warn:  (msg: string, data?: unknown) => log("warn",  context, msg, data),
    error: (msg: string, data?: unknown) => log("error", context, msg, data),
  };
}

export const logger = makeLogger("main");
