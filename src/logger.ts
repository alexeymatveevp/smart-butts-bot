const PREFIX = "[bot]";

export function log(message: string, ...args: unknown[]): void {
  if (args.length > 0) {
    console.log(PREFIX, message, ...args);
  } else {
    console.log(PREFIX, message);
  }
}
