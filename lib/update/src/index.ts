export { fetchLatestRelease } from './releases-client';
export type { FetchLatestReleaseOptions } from './releases-client';

export { compareVersions, isNewerVersion, stripVersionPrefix } from './version';

export { sha256Hex, parseSha256Sidecar, verifySha256 } from './checksum';
export type { ChecksumVerification } from './checksum';

export {
  findAppAsset,
  findSidecarAsset,
  findThemeAsset,
  decideAppUpdate,
  decideThemeUpdate,
} from './decide';
export type { AppTarget, AppUpdateDecision, ThemeUpdateDecision, ThemeAssetMatch } from './decide';

export type {
  ReleaseAsset,
  ReleaseMetadata,
  FetchLike,
  UpdateErrorKind,
  UpdateResult,
} from './types';
