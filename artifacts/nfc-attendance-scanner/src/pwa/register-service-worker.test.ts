import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerServiceWorker } from '@/pwa/register-service-worker';
import type { RuntimeEnvironment } from '@/platform/runtime';

function environment(
  overrides: Partial<RuntimeEnvironment> = {},
): RuntimeEnvironment {
  return {
    target: 'web',
    isProduction: true,
    isCapacitorNative: false,
    hasDesktopBridge: false,
    ...overrides,
  };
}

/**
 * jsdom has no `navigator.serviceWorker`, so each test installs the shape it
 * needs and takes it away again. `configurable` is what makes the delete work.
 */
function stubServiceWorker(register: ReturnType<typeof vi.fn>) {
  Object.defineProperty(navigator, 'serviceWorker', {
    value: { register },
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'serviceWorker');
  vi.restoreAllMocks();
});

describe('registerServiceWorker', () => {
  it('registers sw.js under the build base path for a production web build', async () => {
    const registration = {} as ServiceWorkerRegistration;
    const register = vi.fn().mockResolvedValue(registration);
    stubServiceWorker(register);

    await expect(registerServiceWorker(environment())).resolves.toBe(
      registration,
    );
    expect(register).toHaveBeenCalledWith(
      `${import.meta.env.BASE_URL}sw.js`,
      { scope: import.meta.env.BASE_URL },
    );
  });

  it('does not touch the API at all in the Capacitor build', async () => {
    const register = vi.fn();
    stubServiceWorker(register);

    await expect(
      registerServiceWorker(environment({ target: 'capacitor' })),
    ).resolves.toBeNull();
    expect(register).not.toHaveBeenCalled();
  });

  it('does not touch the API at all in the Electron build', async () => {
    const register = vi.fn();
    stubServiceWorker(register);

    await expect(
      registerServiceWorker(environment({ target: 'electron' })),
    ).resolves.toBeNull();
    expect(register).not.toHaveBeenCalled();
  });

  it('does not touch the API at all in development', async () => {
    const register = vi.fn();
    stubServiceWorker(register);

    await expect(
      registerServiceWorker(environment({ isProduction: false })),
    ).resolves.toBeNull();
    expect(register).not.toHaveBeenCalled();
  });

  it('reports null rather than throwing when the browser has no service workers', async () => {
    await expect(registerServiceWorker(environment())).resolves.toBeNull();
  });

  it('reports null rather than throwing when registration is refused', async () => {
    // An unregistered worker costs an offline launch. It must never cost the
    // app its startup, so the rejection is swallowed and reported as "none".
    stubServiceWorker(vi.fn().mockRejectedValue(new Error('insecure origin')));

    await expect(registerServiceWorker(environment())).resolves.toBeNull();
  });
});
