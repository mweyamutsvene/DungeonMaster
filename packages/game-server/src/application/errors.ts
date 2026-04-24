/**
 * Base error type for application-layer failures.
 * Layer: Application.
 * Notes: Mapped to HTTP responses by the Fastify error handler.
 */
export class ApplicationError extends Error {
  override readonly name: string = "ApplicationError";
}

/**
 * Thrown when requested entities/session state do not exist.
 * Layer: Application.
 * Notes: API maps this to HTTP 404.
 */
export class NotFoundError extends ApplicationError {
  override readonly name = "NotFoundError";

  constructor(message: string) {
    super(message);
  }
}

/**
 * Thrown when a command/input violates server-side invariants.
 * Layer: Application.
 * Notes: API maps this to HTTP 400.
 */
export class ValidationError extends ApplicationError {
  override readonly name = "ValidationError";

  constructor(message: string) {
    super(message);
  }
}

/**
 * Thrown when an optimistic-concurrency write fails because another writer
 * updated the row first (version mismatch on `sheetVersion`, etc.).
 *
 * Layer: Application.
 * Notes: API maps this to HTTP 409. Callers that care about concurrency
 *        (inventory transfer, spell side-effects) catch this and retry once
 *        with the re-read sheet; other callers surface it to the user.
 */
export class ConflictError extends ApplicationError {
  override readonly name = "ConflictError";

  constructor(message: string) {
    super(message);
  }
}
