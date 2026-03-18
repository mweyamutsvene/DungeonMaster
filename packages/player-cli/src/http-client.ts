/**
 * HTTP Client for the DungeonMaster Player CLI
 *
 * Thin wrapper around Node.js built-in `fetch` with timeout, verbose logging,
 * and structured error handling.
 */

export interface HttpClientOptions {
  verbose?: boolean;
  timeoutMs?: number;
}

export class HttpClient {
  constructor(
    private readonly baseUrl: string,
    private readonly options: HttpClientOptions = {},
  ) {}

  async get<T>(path: string, opts?: { timeoutMs?: number }): Promise<T> {
    return this.request<T>(path, { method: "GET" }, opts);
  }

  async post<T>(path: string, body?: unknown, opts?: { timeoutMs?: number }): Promise<T> {
    return this.request<T>(
      path,
      {
        method: "POST",
        body: body !== undefined ? JSON.stringify(body) : undefined,
      },
      opts,
    );
  }

  async patch<T>(path: string, body?: unknown, opts?: { timeoutMs?: number }): Promise<T> {
    return this.request<T>(
      path,
      {
        method: "PATCH",
        body: body !== undefined ? JSON.stringify(body) : undefined,
      },
      opts,
    );
  }

  /**
   * Raw fetch for SSE — returns the Response directly so the caller can
   * consume `response.body` as a ReadableStream.
   */
  async fetchRaw(path: string, init?: RequestInit): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    if (this.options.verbose) {
      console.log(`\n[HTTP] ${init?.method ?? "GET"} ${url} (raw/SSE)`);
    }
    const res = await fetch(url, {
      ...init,
      headers: {
        Accept: "text/event-stream",
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) {
      throw new Error(`SSE connection failed: HTTP ${res.status} ${res.statusText}`);
    }
    return res;
  }

  private async request<T>(
    path: string,
    init?: RequestInit,
    opts?: { timeoutMs?: number },
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const timeoutMs = opts?.timeoutMs ?? this.options.timeoutMs ?? 120_000;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    if (this.options.verbose) {
      console.log(`\n[HTTP] ${init?.method ?? "GET"} ${url}`);
      if (init?.body) {
        console.log(`[HTTP] Body: ${init.body}`);
      }
    }

    let res: Response;
    try {
      res = await fetch(url, {
        ...init,
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          ...(init?.headers ?? {}),
        },
      });
    } catch (err: unknown) {
      const error = err as { name?: string };
      if (error?.name === "AbortError") {
        throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s: ${url}`);
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }

    const text = await res.text();

    if (this.options.verbose) {
      console.log(`[HTTP] Status: ${res.status}`);
      console.log(`[HTTP] Response: ${text.slice(0, 500)}${text.length > 500 ? "..." : ""}`);
    }

    if (!res.ok) {
      let parsed: { message?: string } | undefined;
      try {
        parsed = JSON.parse(text) as { message?: string };
      } catch {
        parsed = undefined;
      }

      const message = typeof parsed?.message === "string" ? parsed.message : undefined;
      throw new Error(`HTTP ${res.status} ${res.statusText}: ${message ?? text}`);
    }

    return JSON.parse(text) as T;
  }
}
