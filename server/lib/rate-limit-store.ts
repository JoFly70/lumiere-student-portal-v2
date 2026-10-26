/**
 * Shared rate-limit store wiring.
 *
 * Limiters are created when their modules are imported, before the server
 * has connected to Redis. Each limiter therefore gets a DeferredStore, which
 * starts on a local MemoryStore and is switched to a Redis-backed store once
 * configureRateLimitBackend() is called at startup (before the server
 * listens). This keeps every limiter, including the authentication limiters,
 * on the same backend so limits hold across application instances.
 */

import {
  MemoryStore,
  type ClientRateLimitInfo,
  type IncrementResponse,
  type Options,
  type Store,
} from 'express-rate-limit';

export type RateLimitBackend = 'memory' | 'redis';
export type RateLimitStoreFactory = (prefix: string) => Store;

const stores = new Set<DeferredStore>();
let backend: RateLimitBackend = 'memory';
let backendFactory: RateLimitStoreFactory | null = null;
// Live availability of the shared backend; only meaningful once it is 'redis'.
let backendHealthy = true;

/** Upper bound for a single Redis command, so a reconnect cannot stall requests. */
export const REDIS_COMMAND_TIMEOUT_MS = 2000;

export function setRateLimitBackendHealthy(healthy: boolean): void {
  backendHealthy = healthy;
}

/**
 * Rejects if a Redis command does not settle within the bound. The rejection
 * reaches express-rate-limit, which (with passOnStoreError left false) fails
 * the request instead of letting it through unlimited.
 */
export function withCommandTimeout<T>(
  command: () => Promise<T>,
  timeoutMs: number = REDIS_COMMAND_TIMEOUT_MS,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Redis command timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    let pending: Promise<T>;
    try {
      pending = command();
    } catch (err) {
      clearTimeout(timer);
      reject(err);
      return;
    }
    pending.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

export interface RedisHealthSource {
  isReady: boolean;
  on(event: string, listener: (...args: any[]) => void): unknown;
  ping(): Promise<unknown>;
}

/** Keeps the readiness flag in step with the client's connection events. */
export function trackRedisHealth(client: RedisHealthSource): void {
  client.on('ready', () => setRateLimitBackendHealthy(true));
  client.on('end', () => setRateLimitBackendHealthy(false));
  client.on('reconnecting', () => setRateLimitBackendHealthy(false));
  // 'error' also reports non-connection faults; only a client that is not ready is unhealthy.
  client.on('error', () => { if (!client.isReady) setRateLimitBackendHealthy(false); });
}

/** Pings Redis (bounded) and records the result in the readiness flag. */
export async function checkRedisHealth(client: RedisHealthSource): Promise<boolean> {
  try {
    await withCommandTimeout(() => client.ping());
    setRateLimitBackendHealthy(client.isReady);
  } catch {
    setRateLimitBackendHealthy(false);
  }
  return backendHealthy;
}

export class DeferredStore implements Store {
  // Each limiter has its own instance and key prefix, so keys never collide.
  localKeys = true;
  private delegate: Store = new MemoryStore();
  private options?: Options;

  constructor(readonly prefix: string) {}

  init(options: Options): void {
    this.options = options;
    this.delegate.init?.(options);
  }

  attach(factory: RateLimitStoreFactory): void {
    const previous = this.delegate;
    this.delegate = factory(this.prefix);
    if (this.options) this.delegate.init?.(this.options);
    void previous.shutdown?.();
  }

  get(key: string): Promise<ClientRateLimitInfo | undefined> | ClientRateLimitInfo | undefined {
    return this.delegate.get?.(key);
  }

  increment(key: string): Promise<IncrementResponse> | IncrementResponse {
    return this.delegate.increment(key);
  }

  decrement(key: string): Promise<void> | void {
    return this.delegate.decrement(key);
  }

  resetKey(key: string): Promise<void> | void {
    return this.delegate.resetKey(key);
  }

  shutdown(): Promise<void> | void {
    return this.delegate.shutdown?.();
  }
}

export function createRateLimitStore(prefix: string): DeferredStore {
  const store = new DeferredStore(prefix);
  if (backendFactory) store.attach(backendFactory);
  stores.add(store);
  return store;
}

/** Moves every limiter, existing and future, onto the given shared backend. */
export function configureRateLimitBackend(factory: RateLimitStoreFactory): void {
  backendFactory = factory;
  for (const store of stores) store.attach(factory);
  backend = 'redis';
}

/**
 * The backend currently usable for distributed limiting: 'redis' only while it
 * is configured and live, so readiness fails when Redis is lost after startup.
 */
export function getRateLimitBackend(): RateLimitBackend {
  return backend === 'redis' && !backendHealthy ? 'memory' : backend;
}
