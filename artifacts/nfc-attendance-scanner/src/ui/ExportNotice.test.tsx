import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ExportNotice } from '@/ui/ExportNotice';

afterEach(cleanup);

const FILENAME = 'attendance-2026-09-15-20260915T170000Z.xlsx';

describe('ExportNotice', () => {
  it('says nothing before an export has been attempted', () => {
    const { container } = render(<ExportNotice result={null} />);

    expect(container.firstChild).toBeNull();
  });

  it('promises only "handed over" for a browser download', () => {
    render(
      <ExportNotice
        result={{ ok: true, filename: FILENAME, delivery: 'download' }}
      />,
    );

    const notice = screen.getByTestId('text-export-saved');
    expect(notice.textContent).toContain(FILENAME);
    // A synthetic <a download> click reports nothing back, so this wording must
    // not claim the file exists.
    expect(notice.textContent).toContain('Check your downloads');
  });

  it('names the device folder for a confirmed native write', () => {
    render(
      <ExportNotice
        result={{
          ok: true,
          filename: FILENAME,
          delivery: 'file',
          uri: `file:///Documents/${FILENAME}`,
        }}
      />,
    );

    expect(screen.getByTestId('text-export-saved').textContent).toContain(
      'Documents',
    );
  });

  it('names the exact path the operator chose for a desktop save', () => {
    render(
      <ExportNotice
        result={{
          ok: true,
          filename: FILENAME,
          delivery: 'saved',
          uri: `/Users/teacher/Desktop/${FILENAME}`,
        }}
      />,
    );

    const notice = screen.getByTestId('text-export-saved');
    expect(notice.textContent).toContain(`/Users/teacher/Desktop/${FILENAME}`);
    expect(notice.textContent).toContain('confirmed on disk');
  });

  it('reports a real failure as an alert', () => {
    render(<ExportNotice result={{ ok: false }} />);

    const failure = screen.getByTestId('text-export-failed');
    expect(failure.getAttribute('role')).toBe('alert');
    expect(failure.textContent).toContain('The export did not run.');
    expect(screen.queryByTestId('text-export-cancelled')).toBeNull();
  });

  it('reports a cancelled save as a cancellation, not a failure', () => {
    render(<ExportNotice result={{ ok: false, cancelled: true }} />);

    const cancelled = screen.getByTestId('text-export-cancelled');
    expect(cancelled.textContent).toContain('Export cancelled.');
    // The distinction is the whole point: closing a Save dialog is a decision,
    // and dressing it up as a failure sends a teacher hunting for a fault that
    // is not there.
    expect(cancelled.getAttribute('role')).toBe('status');
    expect(screen.queryByTestId('text-export-failed')).toBeNull();
    expect(screen.queryByTestId('text-export-saved')).toBeNull();
  });
});

describe('ExportNotice trailer', () => {
  it('tells every successful export where the file may go', () => {
    for (const delivery of ['download', 'file', 'saved'] as const) {
      cleanup();
      render(<ExportNotice result={{ ok: true, filename: FILENAME, delivery }} />);
      expect(screen.getByTestId('text-export-saved').textContent).toContain(
        'Send this file only to a school account.',
      );
    }
  });

  it('says when the activity log entry could not be written, without calling the export a failure', () => {
    render(
      <ExportNotice
        result={{ ok: true, filename: FILENAME, delivery: 'file', logFailed: true }}
      />,
    );
    const notice = screen.getByTestId('text-export-saved');
    expect(notice.textContent).toContain('The activity log entry could not be written.');
    expect(screen.queryByTestId('text-export-failed')).toBeNull();
  });

  it('does not mention the log when it was written', () => {
    render(<ExportNotice result={{ ok: true, filename: FILENAME, delivery: 'file' }} />);
    expect(screen.getByTestId('text-export-saved').textContent).not.toContain(
      'activity log',
    );
  });
});
