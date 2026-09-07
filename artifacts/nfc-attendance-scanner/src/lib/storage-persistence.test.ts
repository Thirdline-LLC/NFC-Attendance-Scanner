import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestPersistentStorage } from './storage-persistence';

// jsdom may or may not define `navigator.storage`; capture whatever it had so
// each test can install its own and afterEach can put the original back.
const originalStorage = Object.getOwnPropertyDescriptor(navigator, 'storage');

function stubNavigatorStorage(storage: unknown) {
  Object.defineProperty(navigator, 'storage', {
    value: storage,
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  if (originalStorage) {
    Object.defineProperty(navigator, 'storage', originalStorage);
  } else {
    delete (navigator as { storage?: unknown }).storage;
  }
});

describe('requestPersistentStorage', () => {
  it('returns true when the engine grants persistence', async () => {
    const persist = vi.fn().mockResolvedValue(true);
    stubNavigatorStorage({ persist });

    await expect(requestPersistentStorage()).resolves.toBe(true);
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('returns false when the engine declines persistence', async () => {
    stubNavigatorStorage({ persist: vi.fn().mockResolvedValue(false) });

    await expect(requestPersistentStorage()).resolves.toBe(false);
  });

  it('returns false when navigator.storage is missing', async () => {
    stubNavigatorStorage(undefined);

    await expect(requestPersistentStorage()).resolves.toBe(false);
  });

  it('returns false when the storage manager has no persist()', async () => {
    stubNavigatorStorage({ estimate: vi.fn() });

    await expect(requestPersistentStorage()).resolves.toBe(false);
  });

  it('returns false instead of throwing when persist() rejects', async () => {
    stubNavigatorStorage({
      persist: vi.fn().mockRejectedValue(new Error('not allowed')),
    });

    await expect(requestPersistentStorage()).resolves.toBe(false);
  });

  it('returns false instead of throwing when persist() throws synchronously', async () => {
    stubNavigatorStorage({
      persist: vi.fn(() => {
        throw new TypeError('Illegal invocation');
      }),
    });

    await expect(requestPersistentStorage()).resolves.toBe(false);
  });

  it('treats a non-boolean resolution as not persisted', async () => {
    stubNavigatorStorage({ persist: vi.fn().mockResolvedValue(undefined) });

    await expect(requestPersistentStorage()).resolves.toBe(false);
  });
});
