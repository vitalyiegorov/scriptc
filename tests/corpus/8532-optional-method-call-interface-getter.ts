interface LoggerService {
  log(message: any, ...optionalParams: any[]): any;
  error(message: any, ...optionalParams: any[]): any;
  debug?(message: any, ...optionalParams: any[]): any;
  setLogLevels?(levels: string[]): any;
}

class Console implements LoggerService {
  log(message: any, ...optionalParams: any[]) {
    console.log('C.log', message, optionalParams.length);
  }
  error(message: any, ...optionalParams: any[]) {
    console.log('C.error', message, optionalParams.length);
  }
  debug(message: any, ...optionalParams: any[]) {
    console.log('C.debug', message, optionalParams.length);
  }
}

class Logger implements LoggerService {
  static ref?: LoggerService = new Console();
  context = 'ctx';

  get local(): LoggerService {
    return Logger.ref!;
  }

  log(message: any, ...optionalParams: any[]) {
    optionalParams = this.context ? optionalParams.concat(this.context) : optionalParams;
    this.local?.log(message, ...optionalParams);
  }
  error(message: any, ...optionalParams: any[]) {
    this.local.error(message, ...optionalParams);
  }
  debug(message: any, ...optionalParams: any[]) {
    this.local?.debug?.(message, ...optionalParams);
  }
}

const l = new Logger();
l.log('a', 1);
l.error('b');
l.debug('c', 1, 2);
Logger.ref = { log: (m: any) => console.log('plain.log', m), error: (m: any) => console.log('plain.error', m) };
l.log('d');
l.debug('e');
