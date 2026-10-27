export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found') {
    super(404, 'not_found', message);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(409, 'conflict', message);
  }
}

export class BadRequestError extends AppError {
  constructor(message: string, details?: unknown) {
    super(400, 'bad_request', message, details);
  }
}

/**
 * Raised by the Discord mention validation (plan section 6.1). Surfaces as HTTP 422 with
 * `{ error: 'validation_failed', code, message, hint }` so the UI can show it inline.
 */
export class ValidationFailedError extends AppError {
  constructor(
    public readonly validationCode: string,
    message: string,
    public readonly hint: string,
  ) {
    super(422, 'validation_failed', message);
  }
}
