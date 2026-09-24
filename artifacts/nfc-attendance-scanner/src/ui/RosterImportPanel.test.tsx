import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RosterImportPanel, type RosterImportPanelProps } from '@/ui/RosterImportPanel';

function baseProps(
  overrides: Partial<RosterImportPanelProps> = {},
): RosterImportPanelProps {
  return {
    onImport: vi.fn().mockResolvedValue(undefined),
    isImporting: false,
    result: null,
    onExport: vi.fn(),
    isExporting: false,
    exportResult: null,
    studentCount: 3,
    activeBody: null,
    onDownloadTemplate: vi.fn(),
    isDownloadingTemplate: false,
    templateResult: null,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe('RosterImportPanel template download', () => {
  it('renders an xlsx button and a secondary CSV button, both accessibly labelled', () => {
    render(<RosterImportPanel {...baseProps()} />);

    const xlsxButton = screen.getByTestId('button-download-template');
    const csvButton = screen.getByTestId('button-download-template-csv');

    expect(xlsxButton.textContent).toContain('Download template');
    expect(xlsxButton.getAttribute('aria-label')).toMatch(/excel/i);
    expect(csvButton.getAttribute('aria-label')).toMatch(/csv/i);
  });

  it('triggers delivery in xlsx format when the primary button is clicked', async () => {
    const onDownloadTemplate = vi.fn();
    const user = userEvent.setup();
    render(
      <RosterImportPanel {...baseProps({ onDownloadTemplate })} />,
    );

    await user.click(screen.getByTestId('button-download-template'));

    expect(onDownloadTemplate).toHaveBeenCalledTimes(1);
    expect(onDownloadTemplate).toHaveBeenCalledWith('xlsx');
  });

  it('triggers delivery in csv format when the secondary button is clicked', async () => {
    const onDownloadTemplate = vi.fn();
    const user = userEvent.setup();
    render(
      <RosterImportPanel {...baseProps({ onDownloadTemplate })} />,
    );

    await user.click(screen.getByTestId('button-download-template-csv'));

    expect(onDownloadTemplate).toHaveBeenCalledTimes(1);
    expect(onDownloadTemplate).toHaveBeenCalledWith('csv');
  });

  it('disables both buttons while a template is being built', () => {
    render(
      <RosterImportPanel
        {...baseProps({ isDownloadingTemplate: true })}
      />,
    );

    expect(
      (screen.getByTestId('button-download-template') as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByTestId('button-download-template-csv') as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.getByTestId('button-download-template').textContent).toContain(
      'Building the template',
    );
  });

  it('shows the delivery notice once a template has been handed over', () => {
    render(
      <RosterImportPanel
        {...baseProps({
          templateResult: {
            ok: true,
            filename: 'tapin-roster-template-robotics-club.xlsx',
            delivery: 'download',
          },
        })}
      />,
    );

    const notice = screen.getByTestId('text-export-saved');
    expect(notice.textContent).toContain('tapin-roster-template-robotics-club.xlsx');
  });
});
