import { describe, expect, it, vi } from 'vitest';
import { fetchLatestRelease } from '../src/releases-client';
import type { FetchLike } from '../src/types';

/** A release payload shaped like the real GitHub API — no student fields anywhere near it. */
function releaseJson(overrides: Record<string, unknown> = {}) {
  return {
    tag_name: 'v1.2.0',
    html_url: 'https://github.com/Thirdline-LLC/NFC-Attendance-Scanner/releases/tag/v1.2.0',
    published_at: '2026-09-20T00:00:00Z',
    assets: [
      {
        name: 'tapin-sjc-v1.1.0.nfc-theme',
        url: 'https://api.github.com/repos/Thirdline-LLC/NFC-Attendance-Scanner/releases/assets/1',
        browser_download_url:
          'https://github.com/Thirdline-LLC/NFC-Attendance-Scanner/releases/download/v1.2.0/tapin-sjc-v1.1.0.nfc-theme',
        size: 4096,
      },
    ],
    ...overrides,
  };
}

function mockFetch(response: {
  ok: boolean;
  status: number;
  json?: () => Promise<unknown>;
}): FetchLike {
  return vi.fn().mockResolvedValue({
    ok: response.ok,
    status: response.status,
    json: response.json ?? (async () => ({})),
  });
}

describe('fetchLatestRelease', () => {
  it('parses a well-formed release response (happy path)', async () => {
    const fetchImpl = mockFetch({ ok: true, status: 200, json: async () => releaseJson() });

    const result = await fetchLatestRelease('Thirdline-LLC', 'NFC-Attendance-Scanner', {
      fetchImpl,
    });

    expect(result).toEqual({
      ok: true,
      value: {
        tag: 'v1.2.0',
        htmlUrl: 'https://github.com/Thirdline-LLC/NFC-Attendance-Scanner/releases/tag/v1.2.0',
        publishedAt: '2026-09-20T00:00:00Z',
        assets: [
          {
            name: 'tapin-sjc-v1.1.0.nfc-theme',
            apiUrl: 'https://api.github.com/repos/Thirdline-LLC/NFC-Attendance-Scanner/releases/assets/1',
            browserDownloadUrl:
              'https://github.com/Thirdline-LLC/NFC-Attendance-Scanner/releases/download/v1.2.0/tapin-sjc-v1.1.0.nfc-theme',
            size: 4096,
          },
        ],
      },
    });
  });

  it('calls the GitHub API with headers only — no body, no student fields', async () => {
    const fetchImpl = mockFetch({ ok: true, status: 200, json: async () => releaseJson() });

    await fetchLatestRelease('Thirdline-LLC', 'NFC-Attendance-Scanner', {
      fetchImpl,
      token: 'device-ops-secret',
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(
      'https://api.github.com/repos/Thirdline-LLC/NFC-Attendance-Scanner/releases/latest',
    );
    expect(init).toEqual({
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: 'Bearer device-ops-secret',
      },
    });
    // No second argument that could carry a request body.
    expect(Object.keys(init as object)).toEqual(['headers']);
  });

  it('reports offline when the fetch itself throws (no network)', async () => {
    const fetchImpl: FetchLike = vi.fn().mockRejectedValue(new Error('network unreachable'));

    const result = await fetchLatestRelease('Thirdline-LLC', 'NFC-Attendance-Scanner', {
      fetchImpl,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('offline');
  });

  it('reports not-found on a 404 (no release published yet)', async () => {
    const fetchImpl = mockFetch({ ok: false, status: 404 });

    const result = await fetchLatestRelease('Thirdline-LLC', 'NFC-Attendance-Scanner', {
      fetchImpl,
    });

    expect(result).toEqual({
      ok: false,
      error: 'not-found',
      message: expect.any(String),
    });
  });

  it('reports rate-limited on 403 and 429', async () => {
    for (const status of [403, 429]) {
      const fetchImpl = mockFetch({ ok: false, status });
      const result = await fetchLatestRelease('Thirdline-LLC', 'NFC-Attendance-Scanner', {
        fetchImpl,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe('rate-limited');
    }
  });

  it('reports http-error on any other non-2xx status', async () => {
    const fetchImpl = mockFetch({ ok: false, status: 500 });

    const result = await fetchLatestRelease('Thirdline-LLC', 'NFC-Attendance-Scanner', {
      fetchImpl,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('http-error');
  });

  it('reports parse-error when the body is not JSON', async () => {
    const fetchImpl = mockFetch({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token');
      },
    });

    const result = await fetchLatestRelease('Thirdline-LLC', 'NFC-Attendance-Scanner', {
      fetchImpl,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('parse-error');
  });

  it('reports parse-error when required fields are missing', async () => {
    const fetchImpl = mockFetch({ ok: true, status: 200, json: async () => ({ assets: [] }) });

    const result = await fetchLatestRelease('Thirdline-LLC', 'NFC-Attendance-Scanner', {
      fetchImpl,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('parse-error');
  });

  it('drops any asset missing required fields rather than failing the whole parse', async () => {
    const fetchImpl = mockFetch({
      ok: true,
      status: 200,
      json: async () =>
        releaseJson({
          assets: [{ name: 'incomplete-asset' }, ...releaseJson().assets],
        }),
    });

    const result = await fetchLatestRelease('Thirdline-LLC', 'NFC-Attendance-Scanner', {
      fetchImpl,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.assets).toHaveLength(1);
  });
});
