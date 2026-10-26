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

export function getRateLimitBackend(): RateLimitBackend {
  return backend;
}
