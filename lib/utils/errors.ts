export interface AppErrorOptions {
  code: string;
  message: string;
  status: number;
  cause?: unknown;
}

export class AppError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(options: AppErrorOptions) {
    super(options.message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "AppError";
    this.code = options.code;
    this.status = options.status;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
