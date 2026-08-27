type LogLevel = "info" | "warn" | "error";

type LogContext = Record<string, unknown>;

interface LogEntry {
  level: LogLevel;
  event: string;
  timestamp: string;
  context?: LogContext;
}

function serializeError(error: unknown): LogContext {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return { value: String(error) };
}

function write(entry: LogEntry): void {
  const line = JSON.stringify(entry);
  if (entry.level === "error") {
    console.error(line);
  } else if (entry.level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

function log(level: LogLevel, event: string, context?: LogContext): void {
  write({
    level,
    event,
    timestamp: new Date().toISOString(),
    ...(context ? { context } : {}),
  });
}

export const logger = {
  info(event: string, context?: LogContext): void {
    log("info", event, context);
  },
  warn(event: string, context?: LogContext): void {
    log("warn", event, context);
  },
  error(event: string, context?: LogContext & { error?: unknown }): void {
    const { error, ...rest } = context ?? {};
    log("error", event, {
      ...rest,
      ...(error !== undefined ? { error: serializeError(error) } : {}),
    });
  },
};
