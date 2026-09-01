export function log(message: string): void {
  process.stdout.write(`[log] ${message}\n`);
}
