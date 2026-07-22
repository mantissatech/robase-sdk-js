import { Robase } from '../src/index.ts';
import type { FetchLike } from '../src/index.ts';

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface StubResponse {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface Stub {
  client: Robase;
  requests: RecordedRequest[];
}

/**
 * Builds a client backed by a scripted fetch. Pass one response per expected
 * call; the last one repeats if the client makes more.
 */
export function stubClient(
  responses: StubResponse | StubResponse[],
  options: { maxRetries?: number } = {},
): Stub {
  const queue = Array.isArray(responses) ? responses : [responses];
  const requests: RecordedRequest[] = [];
  let call = 0;

  const fetchImpl: FetchLike = async (url, init) => {
    const spec = queue[Math.min(call, queue.length - 1)]!;
    call++;

    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(
      (init.headers ?? {}) as Record<string, string>,
    )) {
      headers[key.toLowerCase()] = value;
    }

    requests.push({
      url,
      method: init.method ?? 'GET',
      headers,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    });

    const status = spec.status ?? 200;
    const body =
      typeof spec.body === 'string' ? spec.body : JSON.stringify(spec.body ?? {});

    return new Response(body, {
      status,
      headers: { 'content-type': 'application/json', ...spec.headers },
    });
  };

  const client = new Robase({
    apiKey: 'robe_test_key',
    baseUrl: 'https://api.test.local',
    // Retries are off unless a test opts in, so a test only sees the calls it makes.
    maxRetries: options.maxRetries ?? 0,
    fetch: fetchImpl,
  });

  return { client, requests };
}
