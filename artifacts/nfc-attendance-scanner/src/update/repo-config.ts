/**
 * Where Plan 07 looks for app and theme updates (D-T3: GitHub Releases,
 * reachable from school Wi-Fi, no product restriction).
 *
 * One constant pair, shared by the renderer's release-metadata fetch and the
 * Electron main process's asset-download IPC handler, so the two can never
 * point at different repos.
 */
export const UPDATE_REPO_OWNER = 'Thirdline-LLC';
export const UPDATE_REPO_NAME = 'NFC-Attendance-Scanner';

export const RELEASES_PAGE_URL = `https://github.com/${UPDATE_REPO_OWNER}/${UPDATE_REPO_NAME}/releases`;
