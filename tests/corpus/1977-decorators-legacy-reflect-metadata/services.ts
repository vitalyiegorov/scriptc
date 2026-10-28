export class Logger {
  log(message: string): string { return `log:${message}`; }
}
export interface Clock { now(): number; }
