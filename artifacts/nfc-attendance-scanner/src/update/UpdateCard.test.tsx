import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DesktopBridge } from '@/platform/desktop-bridge';
import { UpdateCard } from './UpdateCard';

const installPack = vi.fn().mockResolvedValue(null);

/**
 * `useUpdateChecker` reads the active theme through `useTheme()`. Mocking the
 * provider — rather than installing a real pack through it — keeps these
 * tests about the update flow, not about Plan 04's own loader (which
 * `@workspace/themes` already covers).
 */
vi.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({
    active: {
      v: 1,
      meta: { id: 'tapin-sjc', orgName: 'St John\'s', version: '1.0.0' },
      fonts: { heading: 'serif', body: 'sans' },
      colors: {},
      assets: { logoMark: 'data:image/svg+xml;base64,' },
      copy: { appName: 'Tapin', shortName: 'Tapin' },
    },
    isCustom: true,
    banner: null,
    installPack,
    activatePack: vi.fn(),
    revertToDefault: vi.fn(),
    dismissBanner: vi.fn(),
  }),
}));

const RELEASE_URL =
  'https://api.github.com/repos/Thirdline-LLC/NFC-Attendance-Scanner/releases/latest';

/** A release with a newer pack for the currently-active theme (`tapin-sjc`). */
function releaseWithNewerTheme() {
  return {
    tag_name: 'v1.0.0',
    html_url: 'https://github.com/Thirdline-LLC/NFC-Attendance-Scanner/releases/tag/v1.0.0',
    published_at: '2026-09-20T00:00:00Z',
    assets: [
      {
        name: 'tapin-sjc-v1.1.0.nfc-theme',
        url: 'https://api.github.com/repos/Thirdline-LLC/NFC-Attendance-Scanner/releases/assets/1',
        browser_download_url: 'https://github.com/.../tapin-sjc-v1.1.0.nfc-theme',
        size: 4096,
      },
      {
        name: 'tapin-sjc-v1.1.0.nfc-theme.sha256',
        url: 'https://api.github.com/repos/Thirdline-LLC/NFC-Attendance-Scanner/releases/assets/2',
        browser_download_url: 'https://github.com/.../tapin-sjc-v1.1.0.nfc-theme.sha256',
        size: 65,
      },
    ],
  };
}

function installDesktopBridge(overrides: Partial<DesktopBridge> = {}): DesktopBridge {
  const bridge: DesktopBridge = {
    platform: 'electron',
    saveWorkbook: vi.fn(),
    revealWorkbook: vi.fn().mockResolvedValue(true),
    downloadVerifiedAsset: vi.fn(),
    openReleasesPage: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
  window.attendanceDesktop = bridge;
  return bridge;
}

describe('UpdateCard', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(window, 'attendanceDesktop');
    installPack.mockClear();
  });

  it('shows a newer theme pack as available (happy-path metadata parse)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => releaseWithNewerTheme(),
      }),
    );
    const user = userEvent.setup();
    render(<UpdateCard />);

    await user.click(screen.getByTestId('button-check-updates'));

    await waitFor(() =>
      expect(screen.getByTestId('text-theme-update-status').textContent).toContain(
        'v1.1.0 is available',
      ),
    );
    // No student data anywhere near the request this sent.
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(RELEASE_URL);
    expect(init).not.toHaveProperty('body');
  });

  it('shows the manual-link fallback when the network check fails (offline/firewall)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unreachable')));
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    const user = userEvent.setup();
    render(<UpdateCard />);

    await user.click(screen.getByTestId('button-check-updates'));

    const error = await screen.findByTestId('text-update-error');
    expect(error.textContent).toMatch(/could not reach github/i);

    await user.click(screen.getByTestId('link-manual-releases-error'));
    expect(openSpy).toHaveBeenCalledWith(
      'https://github.com/Thirdline-LLC/NFC-Attendance-Scanner/releases',
      '_blank',
      'noopener,noreferrer',
    );
  });

  it('refuses a theme install on checksum mismatch — fails closed, never activates it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => releaseWithNewerTheme(),
      }),
    );
    const bridge = installDesktopBridge({
      downloadVerifiedAsset: vi.fn().mockResolvedValue({ ok: false, reason: 'checksum' }),
    });
    const user = userEvent.setup();
    render(<UpdateCard />);

    await user.click(screen.getByTestId('button-check-updates'));
    await screen.findByTestId('button-install-theme-update');
    await user.click(screen.getByTestId('button-install-theme-update'));

    const notice = await screen.findByTestId('text-theme-notice');
    expect(notice.textContent).toMatch(/did not match its published checksum/i);
    expect(bridge.downloadVerifiedAsset).toHaveBeenCalledTimes(1);
    // The refusal happens before Plan 04's activator is ever reached.
    expect(installPack).not.toHaveBeenCalled();
  });

  it('installs and activates a verified theme pack through the Plan 04 loader', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => releaseWithNewerTheme(),
      }),
    );
    const packJson = JSON.stringify({
      v: 1,
      meta: { id: 'tapin-sjc', orgName: 'St John\'s', version: '1.1.0' },
      fonts: { heading: 'serif', body: 'sans' },
      colors: {
        bg: '#fff', fg: '#000', muted: '#888', border: '#ccc', accent: '#00f',
        accentFg: '#fff', success: '#0f0', danger: '#f00', warning: '#ff0',
        surface: '#fff', shadow: '#000',
      },
      assets: { logoMark: 'data:image/svg+xml;base64,PHN2Zy8+' },
      copy: { appName: 'Tapin', shortName: 'Tapin' },
    });
    installDesktopBridge({
      downloadVerifiedAsset: vi.fn().mockResolvedValue({ ok: true, kind: 'theme', text: packJson }),
    });
    installPack.mockResolvedValue(null);
    const user = userEvent.setup();
    render(<UpdateCard />);

    await user.click(screen.getByTestId('button-check-updates'));
    await screen.findByTestId('button-install-theme-update');
    await user.click(screen.getByTestId('button-install-theme-update'));

    await waitFor(() =>
      expect(screen.getByTestId('text-theme-notice').textContent).toContain(
        'Installed and activated v1.1.0',
      ),
    );
    expect(installPack).toHaveBeenCalledWith(packJson);
  });
});
