export class FSError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = "FSError";
    this.code = code;
  }
}

export function isFSError(error) {
  return error instanceof FSError || Boolean(error && error.name === "FSError");
}

export function formatError(error) {
  if (isFSError(error)) return `${error.message} (${error.code})`;
  return error && error.message ? error.message : String(error);
}
