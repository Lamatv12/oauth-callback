/**
 * Cross-runtime HTTP server for handling OAuth callbacks.
 *
 * SPDX-FileCopyrightText: 2025-present Kriasoft
 * SPDX-License-Identifier: MIT
 */

import { successTemplate, renderError } from "./templates";

/**
 * Result object returned from OAuth callback containing authorization code or error details
 */
export interface CallbackResult {
  /** Authorization code returned by OAuth provider */
  code?: string;
  /** State parameter for CSRF protection */
  state?: string;
  /** OAuth error code (e.g., 'access_denied', 'invalid_request') */
  error?: string;
  /** Human-readable error description */
  error_description?: string;
  /** URI with additional error information */
  error_uri?: string;
  /** Additional query parameters from OAuth provider */
  [key: string]: string | undefined;
}

/**
 * Configuration options for the OAuth callback server
 */
export interface ServerOptions {
  /** Port number to bind the server to */
  port: number;
  /** Hostname to bind the server to (default: "localhost") */
  hostname?: string;
  /** Custom HTML content for successful authorization */
  successHtml?: string;
  /** Custom HTML template for error pages (supports {{error}}, {{error_description}}, {{error_uri}} placeholders) */
  errorHtml?: string;
  /** AbortSignal for cancelling the server operation */
  signal?: AbortSignal;
  /** Callback function called for each HTTP request (useful for logging/debugging) */
  onRequest?: (req: Request) => void;
}

/**
 * Interface for OAuth callback server implementations across different runtimes
 */
export interface CallbackServer {
  /** Start the HTTP server with the given options */
  start(options: ServerOptions): Promise<void>;
  /** Wait for OAuth callback on the specified path with timeout */
  waitForCallback(path: string, timeout: number): Promise<CallbackResult>;
  /** Stop the server and cleanup resources */
  stop(): Promise<void>;
}

/**
 * Generate HTML response for OAuth callback
 * @param params - OAuth callback parameters (code, error, etc.)
 * @param successHtml - Custom success HTML template
 * @param errorHtml - Custom error HTML template with placeholder support
 * @returns Rendered HTML content
 */
function generateCallbackHTML(
  params: CallbackResult,
  successHtml?: string,
  errorHtml?: string,
): string {
  if (params.error) {
    // Use custom error HTML if provided
    if (errorHtml) {
      return errorHtml
        .replace(/{{error}}/g, params.error || "")
        .replace(/{{error_description}}/g, params.error_description || "")
        .replace(/{{error_uri}}/g, params.error_uri || "");
    }
    return renderError({
      error: params.error,
      error_description: params.error_description,
      error_uri: params.error_uri,
    });
  }
  // Use custom success HTML if provided
  return successHtml || successTemplate;
}

/**
 * Bun runtime implementation using Bun.serve()
 */
class BunCallbackServer implements CallbackServer {
  private server: any; // Runtime-specific server type (Bun.Server)
  private callbackPromise?: {
    resolve: (result: CallbackResult) => void;
    reject: (error: Error) => void;
  };
  private callbackPath: string = "/callback";
  private successHtml?: string;
  private errorHtml?: string;
  private onRequest?: (req: Request) => void;
  private abortHandler?: () => void;

  async start(options: ServerOptions): Promise<void> {
    const {
      port,
      hostname = "localhost",
      successHtml,
      errorHtml,
      signal,
      onRequest,
    } = options;

    this.successHtml = successHtml;
    this.errorHtml = errorHtml;
    this.onRequest = onRequest;

    // Handle abort signal
    if (signal) {
      if (signal.aborted) {
        throw new Error("Operation aborted");
      }
      this.abortHandler = () => {
        this.stop();
        if (this.callbackPromise) {
          this.callbackPromise.reject(new Error("Operation aborted"));
        }
      };
      signal.addEventListener("abort", this.abortHandler);
    }

    // @ts-ignore - Bun global not available in TypeScript definitions
    this.server = Bun.serve({
      port,
      hostname,
      fetch: (request: Request) => this.handleRequest(request),
    });
  }

  private handleRequest(request: Request): Response {
    // Call onRequest callback if provided
    if (this.onRequest) {
      this.onRequest(request);
    }

    const url = new URL(request.url);

    if (url.pathname === this.callbackPath) {
      const params: CallbackResult = {};

      // Parse all query parameters
      for (const [key, value] of url.searchParams) {
        params[key] = value;
      }

      // Resolve the callback promise
      if (this.callbackPromise) {
        this.callbackPromise.resolve(params);
      }

      // Return success or error HTML page
      return new Response(
        generateCallbackHTML(params, this.successHtml, this.errorHtml),
        {
          status: 200,
          headers: { "Content-Type": "text/html" },
        },
      );
    }

    return new Response("Not Found", { status: 404 });
  }

  async waitForCallback(
    path: string,
    timeout: number,
  ): Promise<CallbackResult> {
    this.callbackPath = path;

    return new Promise((resolve, reject) => {
      let isResolved = false;

      const timer = setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          this.callbackPromise = undefined;
          reject(
            new Error(
              `OAuth callback timeout after ${timeout}ms waiting for ${path}`,
            ),
          );
        }
      }, timeout);

      const wrappedResolve = (result: CallbackResult) => {
        if (!isResolved) {
          isResolved = true;
          clearTimeout(timer);
          this.callbackPromise = undefined;
          resolve(result);
        }
      };

      const wrappedReject = (error: Error) => {
        if (!isResolved) {
          isResolved = true;
          clearTimeout(timer);
          this.callbackPromise = undefined;
          reject(error);
        }
      };

      this.callbackPromise = { resolve: wrappedResolve, reject: wrappedReject };
    });
  }

  async stop(): Promise<void> {
    if (this.abortHandler) {
      // Remove abort handler if it was set
      const signal = this.server?.signal;
      if (signal) {
        signal.removeEventListener("abort", this.abortHandler);
      }
      this.abortHandler = undefined;
    }
    if (this.callbackPromise) {
      this.callbackPromise.reject(
        new Error("Server stopped before callback received"),
      );
      this.callbackPromise = undefined;
    }
    if (this.server) {
      this.server.stop();
      this.server = undefined;
    }
  }
}

/**
 * Deno runtime implementation using Deno.serve()
 */
class DenoCallbackServer implements CallbackServer {
  private server: any; // Runtime-specific server type (Deno.HttpServer)
  private callbackPromise?: {
    resolve: (result: CallbackResult) => void;
    reject: (error: Error) => void;
  };
  private callbackPath: string = "/callback";
  private abortController?: AbortController;
  private successHtml?: string;
  private errorHtml?: string;
  private onRequest?: (req: Request) => void;
  private abortHandler?: () => void;

  async start(options: ServerOptions): Promise<void> {
    const {
      port,
      hostname = "localhost",
      successHtml,
      errorHtml,
      signal,
      onRequest,
    } = options;

    this.successHtml = successHtml;
    this.errorHtml = errorHtml;
    this.onRequest = onRequest;

    this.abortController = new AbortController();

    // Handle user's abort signal
    if (signal) {
      if (signal.aborted) {
        throw new Error("Operation aborted");
      }
      this.abortHandler = () => {
        this.abortController?.abort();
        if (this.callbackPromise) {
          this.callbackPromise.reject(new Error("Operation aborted"));
        }
      };
      signal.addEventListener("abort", this.abortHandler);
    }

    // @ts-ignore - Deno global not available in TypeScript definitions
    this.server = Deno.serve(
      { port, hostname, signal: this.abortController.signal },
      (request: Request) => this.handleRequest(request),
    );
  }

  private handleRequest(request: Request): Response {
    // Call onRequest callback if provided
    if (this.onRequest) {
      this.onRequest(request);
    }

    const url = new URL(request.url);

    if (url.pathname === this.callbackPath) {
      const params: CallbackResult = {};

      // Parse all query parameters
      for (const [key, value] of url.searchParams) {
        params[key] = value;
      }

      // Resolve the callback promise
      if (this.callbackPromise) {
        this.callbackPromise.resolve(params);
      }

      // Return success or error HTML page
      return new Response(
        generateCallbackHTML(params, this.successHtml, this.errorHtml),
        {
          status: 200,
          headers: { "Content-Type": "text/html" },
        },
      );
    }

    return new Response("Not Found", { status: 404 });
  }

  async waitForCallback(
    path: string,
    timeout: number,
  ): Promise<CallbackResult> {
    this.callbackPath = path;

    return new Promise((resolve, reject) => {
      let isResolved = false;

      const timer = setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          this.callbackPromise = undefined;
          reject(
            new Error(
              `OAuth callback timeout after ${timeout}ms waiting for ${path}`,
            ),
          );
        }
      }, timeout);

      const wrappedResolve = (result: CallbackResult) => {
        if (!isResolved) {
          isResolved = true;
          clearTimeout(timer);
          this.callbackPromise = undefined;
          resolve(result);
        }
      };

      const wrappedReject = (error: Error) => {
        if (!isResolved) {
          isResolved = true;
          clearTimeout(timer);
          this.callbackPromise = undefined;
          reject(error);
        }
      };

      this.callbackPromise = { resolve: wrappedResolve, reject: wrappedReject };
    });
  }

  async stop(): Promise<void> {
    if (this.abortHandler) {
      // Remove abort handler if it was set
      const signal = this.server?.signal;
      if (signal) {
        signal.removeEventListener("abort", this.abortHandler);
      }
      this.abortHandler = undefined;
    }
    if (this.callbackPromise) {
      this.callbackPromise.reject(
        new Error("Server stopped before callback received"),
      );
      this.callbackPromise = undefined;
    }
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = undefined;
    }
    this.server = undefined;
  }
}

/**
 * Node.js implementation using node:http with Web Standards APIs
 * Works with Node.js 18+ which has native Request/Response support
 */
class NodeCallbackServer implements CallbackServer {
  private server?: any; // Runtime-specific server type (http.Server)
  private callbackPromise?: {
    resolve: (result: CallbackResult) => void;
    reject: (error: Error) => void;
  };
  private callbackPath: string = "/callback";
  private successHtml?: string;
  private errorHtml?: string;
  private onRequest?: (req: Request) => void;
  private abortHandler?: () => void;

  async start(options: ServerOptions): Promise<void> {
    const {
      port,
      hostname = "localhost",
      successHtml,
      errorHtml,
      signal,
      onRequest,
    } = options;

    this.successHtml = successHtml;
    this.errorHtml = errorHtml;
    this.onRequest = onRequest;

    // Handle abort signal
    if (signal) {
      if (signal.aborted) {
        throw new Error("Operation aborted");
      }
      this.abortHandler = () => {
        this.stop();
        if (this.callbackPromise) {
          this.callbackPromise.reject(new Error("Operation aborted"));
        }
      };
      signal.addEventListener("abort", this.abortHandler);
    }

    const { createServer } = await import("node:http");

    return new Promise((resolve, reject) => {
      this.server = createServer(async (req, res) => {
        try {
          // Convert Node.js IncomingMessage to Web Standards Request
          const request = this.nodeToWebRequest(req, port);

          // Handle request using Web Standards
          const response = await this.handleRequest(request);

          // Write Web Standards Response back to Node.js ServerResponse
          res.writeHead(
            response.status,
            Object.fromEntries(response.headers.entries()),
          );
          const body = await response.text();
          res.end(body);
        } catch (error) {
          res.writeHead(500);
          res.end("Internal Server Error");
        }
      });

      this.server.listen(port, hostname, () => resolve());
      this.server.on("error", reject);
    });
  }

  /**
   * Convert Node.js IncomingMessage to Web Standards Request
   */
  private nodeToWebRequest(req: any, port: number): Request {
    const url = new URL(req.url!, `http://localhost:${port}`);

    // Convert Node.js headers to Headers object
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === "string") {
        headers.set(key, value);
      } else if (Array.isArray(value)) {
        headers.set(key, value.join(", "));
      }
    }

    // OAuth callbacks use GET requests without body
    return new Request(url.toString(), {
      method: req.method,
      headers,
    });
  }

  /**
   * Handle request using Web Standards APIs (same as Bun/Deno implementations)
   */
  private async handleRequest(request: Request): Promise<Response> {
    // Call onRequest callback if provided
    if (this.onRequest) {
      this.onRequest(request);
    }

    const url = new URL(request.url);

    if (url.pathname === this.callbackPath) {
      const params: CallbackResult = {};

      // Parse all query parameters
      for (const [key, value] of url.searchParams) {
        params[key] = value;
      }

      // Resolve the callback promise
      if (this.callbackPromise) {
        this.callbackPromise.resolve(params);
      }

      // Return success or error HTML page
      return new Response(
        generateCallbackHTML(params, this.successHtml, this.errorHtml),
        {
          status: 200,
          headers: { "Content-Type": "text/html" },
        },
      );
    }

    return new Response("Not Found", { status: 404 });
  }

  async waitForCallback(
    path: string,
    timeout: number,
  ): Promise<CallbackResult> {
    this.callbackPath = path;

    return new Promise((resolve, reject) => {
      let isResolved = false;

      const timer = setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          this.callbackPromise = undefined;
          reject(
            new Error(
              `OAuth callback timeout after ${timeout}ms waiting for ${path}`,
            ),
          );
        }
      }, timeout);

      const wrappedResolve = (result: CallbackResult) => {
        if (!isResolved) {
          isResolved = true;
          clearTimeout(timer);
          this.callbackPromise = undefined;
          resolve(result);
        }
      };

      const wrappedReject = (error: Error) => {
        if (!isResolved) {
          isResolved = true;
          clearTimeout(timer);
          this.callbackPromise = undefined;
          reject(error);
        }
      };

      this.callbackPromise = { resolve: wrappedResolve, reject: wrappedReject };
    });
  }

  async stop(): Promise<void> {
    if (this.abortHandler) {
      // Remove abort handler if it was set
      const signal = this.server?.signal;
      if (signal) {
        signal.removeEventListener("abort", this.abortHandler);
      }
      this.abortHandler = undefined;
    }
    if (this.callbackPromise) {
      this.callbackPromise.reject(
        new Error("Server stopped before callback received"),
      );
      this.callbackPromise = undefined;
    }
    if (this.server) {
      return new Promise((resolve) => {
        this.server.close(() => resolve());
        this.server = undefined;
      });
    }
  }
}

/**
 * Create a callback server for the current runtime (Bun, Deno, or Node.js)
 * Automatically detects the runtime and returns appropriate server implementation
 * @returns CallbackServer instance optimized for the current runtime
 */
export function createCallbackServer(): CallbackServer {
  // @ts-ignore - Bun global not available in TypeScript definitions
  if (typeof Bun !== "undefined") {
    return new BunCallbackServer();
  }

  // @ts-ignore - Deno global not available in TypeScript definitions
  if (typeof Deno !== "undefined") {
    return new DenoCallbackServer();
  }

  // Default to Node.js
  return new NodeCallbackServer();
}
