/** One asset attached to a GitHub Release — an installer, a theme pack, or a `.sha256` sidecar. */
export type ReleaseAsset = {
  name: string;
  /** The GitHub API asset URL (`.../releases/assets/{id}`) — the one with CORS on its metadata. */
  apiUrl: string;
  /** The public `github.com/.../releases/download/...` URL, for a manual/browser download. */
  browserDownloadUrl: string;
  size: number;
};

/** The subset of a GitHub Release this package reads. Never carries student data — see FORBIDDEN. */
export type ReleaseMetadata = {
  /** e.g. `v1.2.0`. */
  tag: string;
  /** The Release's own page — the manual fallback link. */
  htmlUrl: string;
  publishedAt: string | null;
  assets: ReleaseAsset[];
};

/** A `fetch`-compatible function, injected so callers control CORS/Node/mock behaviour. */
export type FetchLike = (
  input: string,
  init?: { headers?: Record<string, string> },
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

export type UpdateErrorKind =
  | 'offline'
  | 'not-found'
  | 'rate-limited'
  | 'http-error'
  | 'parse-error';

export type UpdateResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: UpdateErrorKind; message: string };
