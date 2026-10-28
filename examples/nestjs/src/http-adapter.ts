// A minimal Nest HTTP adapter on top of `node:http`.
//
// It extends Nest's public `AbstractHttpAdapter` extension point and implements
// only what this example's router needs: literal and `:param` route matching,
// JSON/text replies, headers, status codes, redirects, the not-found and
// exception layers, `listen()` and `close()`. Middleware, CORS, static assets,
// views, versioning, global prefixes and HTTPS throw instead of behaving
// differently from the Express adapter. Request bodies are not parsed: Nest
// registers its body parsers at startup whatever the routes are, so that call
// is a no-op and `@Body()` reads `undefined`.
import { BadRequestException, StreamableFile } from '@nestjs/common';
import type { NestApplicationOptions } from '@nestjs/common';
import { AbstractHttpAdapter } from '@nestjs/core';
import * as http from 'node:http';

/**
 * The request object Nest's router sees. Like Fastify's request it wraps the
 * Node request (`raw`) rather than adding properties to it.
 */
export class Request {
  readonly method: string;
  readonly url: string;
  readonly headers: http.IncomingHttpHeaders;
  params: Record<string, string> = {};
  readonly query: Record<string, string>;
  readonly body: unknown = undefined; // bodies are not parsed

  constructor(readonly raw: http.IncomingMessage, query: Record<string, string>) {
    this.method = raw.method ?? 'GET';
    this.url = raw.url ?? '/';
    this.headers = raw.headers;
    this.query = query;
  }
}

type Response = http.ServerResponse;
type Next = (error?: unknown) => void;
type Handler = (req: Request, res: Response, next: Next) => unknown;
type ErrorHandler = (error: unknown, req: Request, res: Response, next: Next) => unknown;

interface Route {
  method: string | undefined; // undefined matches every method
  segments: string[];
  handler: Handler;
}

function splitPath(path: string): string[] {
  return path.split('/').filter(segment => segment.length > 0);
}

function unsupported(feature: string): never {
  throw new Error(`NodeHttpAdapter does not support ${feature}`);
}

/** Ordered route table: the first route whose method and path match handles the request. */
class RouteTable {
  private readonly routes: Route[] = [];
  notFound: Handler | undefined;
  onError: ErrorHandler | undefined;
  server: http.Server | undefined;

  // The base adapter's listen() calls instance.listen(port, hostname, callback);
  // without a hostname, the callback arrives second.
  listen(port: string | number, hostname?: string | (() => void), callback?: () => void): http.Server {
    const server = this.server ?? unsupported('listen() before initHttpServer()');
    if (typeof hostname === 'function') return server.listen(Number(port), () => hostname());
    return server.listen(Number(port), hostname, () => callback?.());
  }

  get(path: string, handler: Handler) { this.add('GET', path, handler); }
  post(path: string, handler: Handler) { this.add('POST', path, handler); }
  put(path: string, handler: Handler) { this.add('PUT', path, handler); }
  delete(path: string, handler: Handler) { this.add('DELETE', path, handler); }
  patch(path: string, handler: Handler) { this.add('PATCH', path, handler); }
  head(path: string, handler: Handler) { this.add('HEAD', path, handler); }
  options(path: string, handler: Handler) { this.add('OPTIONS', path, handler); }
  all(path: string, handler: Handler) { this.add(undefined, path, handler); }
  use(): never { return unsupported('middleware'); }

  private add(method: string | undefined, path: string, handler: Handler): void {
    this.routes.push({ method, segments: splitPath(path), handler });
  }

  private match(route: Route, method: string, segments: string[]): Record<string, string> | undefined {
    // Like Express, GET routes also answer HEAD requests.
    if (route.method !== undefined && route.method !== method && !(method === 'HEAD' && route.method === 'GET')) return undefined;
    if (route.segments.length !== segments.length) return undefined;
    const params: Record<string, string> = {};
    for (let i = 0; i < segments.length; i++) {
      const pattern = route.segments[i];
      if (pattern.startsWith(':')) params[pattern.slice(1)] = decodeURIComponent(segments[i]);
      else if (pattern !== segments[i]) return undefined;
    }
    return params;
  }

  handle(raw: http.IncomingMessage, res: Response): void {
    const url = new URL(raw.url ?? '/', 'http://localhost');
    const req = new Request(raw, Object.fromEntries(url.searchParams));
    const method = req.method;
    const segments = splitPath(url.pathname);
    let index = 0;
    const fail = (error: unknown) => {
      if (this.onError) {
        Promise.resolve()
          .then(() => this.onError!(error, req, res, () => {}))
          .catch(() => this.internalError(res));
      } else {
        this.internalError(res);
      }
    };
    const next: Next = error => {
      if (error !== undefined) return fail(error);
      try {
        while (index < this.routes.length) {
          const route = this.routes[index++];
          const params = this.match(route, method, segments);
          if (params) {
            req.params = params;
            Promise.resolve(route.handler(req, res, next)).catch(fail);
            return;
          }
        }
        if (this.notFound) Promise.resolve(this.notFound(req, res, next)).catch(fail);
        else this.internalError(res);
      } catch (error) {
        // decodeURIComponent() throws URIError for a malformed :param.
        fail(error);
      }
    };
    next();
  }

  private internalError(res: Response): void {
    if (!res.headersSent) {
      res.statusCode = 500;
      res.end();
    }
  }
}

// The overrides keep the base class's parameter types (`any` requests and
// responses, its default type arguments): scriptc compiles a method override
// only when its parameters match the overridden method's.
export class NodeHttpAdapter extends AbstractHttpAdapter {
  constructor() {
    super(new RouteTable());
  }

  private get routes(): RouteTable {
    return this.getInstance<RouteTable>();
  }

  getType(): string {
    return 'node-http';
  }

  initHttpServer(options: NestApplicationOptions): any {
    if (options?.httpsOptions) unsupported('HTTPS');
    this.httpServer = http.createServer((req, res) => this.routes.handle(req, res));
    this.routes.server = this.httpServer;
  }

  close(): any {
    if (!this.httpServer) return undefined;
    return new Promise<void>(resolve => this.httpServer.close(() => resolve()));
  }

  normalizePath(path: string): string {
    for (const segment of splitPath(path)) {
      if (/[*{}?()]/.test(segment)) unsupported(`the route path "${path}" (only literal and :param segments)`);
    }
    return path;
  }

  reply(response: any, body: any, statusCode?: number): any {
    if (statusCode !== undefined) response.statusCode = statusCode;
    if (body === undefined || body === null) return response.end();
    if (body instanceof StreamableFile) unsupported('StreamableFile');
    const isJson = typeof body === 'object';
    const text = isJson ? JSON.stringify(body) : String(body);
    if (!response.hasHeader('Content-Type')) {
      response.setHeader('Content-Type', isJson ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8');
    }
    response.setHeader('Content-Length', Buffer.byteLength(text));
    return response.end(text);
  }

  status(response: any, statusCode: number): any {
    response.statusCode = statusCode;
  }

  end(response: any, message?: string): any {
    return response.end(message);
  }

  redirect(response: any, statusCode: number, url: string): any {
    response.statusCode = statusCode;
    response.setHeader('Location', url);
    return response.end();
  }

  isHeadersSent(response: any): any {
    return response.headersSent;
  }

  getHeader(response: any, name: string): any {
    return response.getHeader(name);
  }

  setHeader(response: any, name: string, value: string): any {
    return response.setHeader(name, value);
  }

  appendHeader(response: any, name: string, value: string): any {
    const current = response.getHeader(name);
    if (current === undefined) return response.setHeader(name, value);
    return response.setHeader(name, Array.isArray(current) ? [...current, value] : [String(current), value]);
  }

  getRequestHostname(request: any): any {
    return request.headers.host?.replace(/:\d+$/, '');
  }

  getRequestMethod(request: any): any {
    return request.method;
  }

  getRequestUrl(request: any): any {
    return request.url;
  }

  setErrorHandler(handler: ErrorHandler): any {
    this.routes.onError = handler;
  }

  setNotFoundHandler(handler: Handler, prefix?: string): any {
    if (prefix) unsupported('a global prefix');
    this.routes.notFound = handler;
  }

  mapException(error: unknown): unknown {
    // A malformed :param encoding is a client error, as with Express.
    return error instanceof URIError ? new BadRequestException(error.message) : error;
  }

  // Called at startup unless `bodyParser: false`; bodies stay unparsed.
  registerParserMiddleware(): any {}

  createMiddlewareFactory(): any {
    return unsupported('middleware');
  }

  enableCors(): any {
    return unsupported('CORS');
  }

  useStaticAssets(): any {
    return unsupported('static assets');
  }

  setViewEngine(): any {
    return unsupported('view engines');
  }

  render(): any {
    return unsupported('views');
  }

  applyVersionFilter(): never {
    return unsupported('versioning');
  }
}
