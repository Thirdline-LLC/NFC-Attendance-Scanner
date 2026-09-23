import { describe, expect, it } from 'vitest';
import { FORBIDDEN_THEME_FIELDS } from '@workspace/themes';
import { fetchLatestRelease } from '../src/releases-client';
import type { FetchLike } from '../src/types';

/**
 * FERPA (D4): this package's whole surface is release metadata and asset
 * bytes — never student records. These tests scan both the shape of what it
 * sends and the shape of what a plausible response contains for the same
 * field names Plan 04 forbids in theme packs.
 */
describe('no student data crosses the update-checker network path', () => {
  it('the request this package sends carries no body and no forbidden field names', async () => {
    const fetchImpl: FetchLike = async (_url, init) => ({
      ok: true,
      status: 200,
      json: async () => ({
        tag_name: 'v1.0.0',
        html_url: 'https://github.com/Thirdline-LLC/NFC-Attendance-Scanner/releases/tag/v1.0.0',
        published_at: null,
        assets: [],
      }),
    });

    let capturedInit: unknown;
    const spy: FetchLike = async (url, init) => {
      capturedInit = init;
      return fetchImpl(url, init);
    };

    await fetchLatestRelease('Thirdline-LLC', 'NFC-Attendance-Scanner', { fetchImpl: spy });

    // Headers only — no `body` key exists on the request init this package builds.
    expect(capturedInit).not.toHaveProperty('body');
    const serialized = JSON.stringify(capturedInit).toLowerCase();
    for (const field of FORBIDDEN_THEME_FIELDS) {
      expect(serialized).not.toContain(field.toLowerCase());
    }
  });

  it('a release response is only ever read for tag/url/asset-name/size — never scanned for or trusting arbitrary fields', async () => {
    // A response that (maliciously or accidentally) carries student-shaped
    // fields must not surface them anywhere in the parsed value.
    const pollutedResponse = {
      tag_name: 'v1.0.0',
      html_url: 'https://github.com/Thirdline-LLC/NFC-Attendance-Scanner/releases/tag/v1.0.0',
      published_at: null,
      assets: [],
      members: [{ firstName: 'Jane', cardUid: '04A1B2C3D4E5F6' }],
      pinHash: 'should-never-be-read',
    };
    const fetchImpl: FetchLike = async () => ({
      ok: true,
      status: 200,
      json: async () => pollutedResponse,
    });

    const result = await fetchLatestRelease('Thirdline-LLC', 'NFC-Attendance-Scanner', {
      fetchImpl,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const serialized = JSON.stringify(result.value).toLowerCase();
      for (const field of FORBIDDEN_THEME_FIELDS) {
        expect(serialized).not.toContain(field.toLowerCase());
      }
    }
  });
});
