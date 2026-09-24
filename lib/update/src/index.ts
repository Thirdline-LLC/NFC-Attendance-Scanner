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
export type {
  AppTarget,
  AppUpdateDecision,
  HostArch,
  ThemeUpdateDecision,
  ThemeAssetMatch,
} from './decide';

export {
  EXPECTED_MAC_APP_NAME,
  resolveInstalledAppBundle,
  assessInstalledBundle,
  chooseBundledApp,
  parseHdiutilMountPoint,
  hdiutilAttachArgs,
  hdiutilDetachArgs,
  selectInstallerName,
} from './app-bundle';

export {
  UPDATE_PHASE_LABEL,
  initialUpdateInstallState,
  reduceUpdateInstall,
} from './install-machine';
export type { UpdatePhase, UpdateInstallState, UpdateInstallEvent } from './install-machine';

export { renderInPlaceHelperScript, renderInPlaceSwapScript } from './in-place-helper';

export { runInPlaceInstall } from './in-place-install';
export type {
  FetchedAsset,
  InPlaceFailureReason,
  InPlaceHost,
  InPlaceInstallRequest,
  InPlaceInstallResult,
  InPlaceProgressPhase,
} from './in-place-install';

export type {
  ReleaseAsset,
  ReleaseMetadata,
  FetchLike,
  UpdateErrorKind,
  UpdateResult,
} from './types';
