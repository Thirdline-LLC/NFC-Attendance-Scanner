import type { FetchLike, ReleaseAsset, ReleaseMetadata, UpdateResult } from './types';

export type FetchLatestReleaseOptions = {
  /** Injected rather than read off `globalThis` — the caller decides which
   * `fetch` runs (browser, Node in the Electron main process, or a test mock),
   * so this package never assumes it can bypass CORS. */
  fetchImpl: FetchLike;
  /**
   * A device-ops secret for a private repo — never a value tied to student
   * data. See `docs/update-token-ops.md`. Sent as `Authorization: Bearer`,
   * never logged.
   */
  token?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseAsset(raw: unknown): ReleaseAsset | null {
  if (!isRecord(raw)) return null;
  const { name, url, browser_download_url: browserDownloadUrl, size } = raw;
  if (
    typeof name !== 'string' ||
    typeof url !== 'string' ||
    typeof browserDownloadUrl !== 'string' ||
    typeof size !== 'number'
  ) {
    return null;
  }
  return { name, apiUrl: url, browserDownloadUrl, size };
}

function parseRelease(raw: unknown): ReleaseMetadata | null {
  if (!isRecord(raw)) return null;
  const { tag_name: tag, html_url: htmlUrl, published_at: publishedAt, assets } = raw;
  if (typeof tag !== 'string' || typeof htmlUrl !== 'string' || !Array.isArray(assets)) {
    return null;
  }

  const parsedAssets: ReleaseAsset[] = [];
  for (const rawAsset of assets) {
    const asset = parseAsset(rawAsset);
    if (asset) parsedAssets.push(asset);
  }

  return {
    tag,
    htmlUrl,
    publishedAt: typeof publishedAt === 'string' ? publishedAt : null,
    assets: parsedAssets,
  };
}

/**
 * Fetches the latest Release's metadata (tag, page URL, assets) for
 * `owner/repo`. CORS-safe everywhere: the GitHub REST API sends
 * `Access-Control-Allow-Origin: *` on this endpoint. Asset **bytes** are a
 * separate concern this package does not fetch itself — see `checksum.ts`
 * and the Electron-only download handler in the app, since the Release asset
 * CDN does not send CORS headers on the blob response.
 */
export async function fetchLatestRelease(
  owner: string,
  repo: string,
  { fetchImpl, token }: FetchLatestReleaseOptions,
): Promise<UpdateResult<ReleaseMetadata>> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  let response: Awaited<ReturnType<FetchLike>>;
  try {
    response = await fetchImpl(
      `https://api.github.com/repos/${owner}/${repo}/releases/latest`,
      { headers },
    );
  } catch {
    return {
      ok: false,
      error: 'offline',
      message: 'Could not reach GitHub. Check the network connection.',
    };
  }

  if (response.status === 404) {
    return { ok: false, error: 'not-found', message: 'No release has been published yet.' };
  }
  if (response.status === 403 || response.status === 429) {
    return {
      ok: false,
      error: 'rate-limited',
      message: 'GitHub is rate-limiting this network. Try again later.',
    };
  }
  if (!response.ok) {
    return {
      ok: false,
      error: 'http-error',
      message: `GitHub returned an unexpected error (${response.status}).`,
    };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, error: 'parse-error', message: 'The release response was not valid JSON.' };
  }

  const release = parseRelease(body);
  if (!release) {
    return { ok: false, error: 'parse-error', message: 'The release response was missing expected fields.' };
  }

  return { ok: true, value: release };
}
