export class DomainError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.status = status;
  }
}

export function notFound(message = "Not found"): never {
  throw new DomainError("NOT_FOUND", message, 404);
}

export function conflict(code: string, message: string): never {
  throw new DomainError(code, message, 409);
}
