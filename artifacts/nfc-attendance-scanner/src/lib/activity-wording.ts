import type { ActivityEntry } from '@/data/attendance-store';
import { formatSessionDateLabel } from '@/lib/session-formatting';

/** A row of the log as two short strings: what happened, and the figures. */
export type ActivityWording = { action: string; detail: string };

function count(value: number | undefined, noun: string): string {
  const n = value ?? 0;
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

/** Where an export went, in the words the export notice already uses. */
function delivered(entry: ActivityEntry): string {
  switch (entry.delivery) {
    case 'saved':
      return 'saved';
    case 'file':
      return 'saved to Documents';
    case 'download':
      return 'handed to the browser';
    default:
      return '';
  }
}

/** `, 6 bodies` after a class-wide export's figures; nothing otherwise. */
function acrossBodies(entry: ActivityEntry): string {
  if (entry.scope !== 'subtree') return '';
  const n = entry.bodies ?? 0;
  return ` across ${n} ${n === 1 ? 'body' : 'bodies'}`;
}

/**
 * Turns a log row into words for the dashboard and the export's second sheet.
 * One place, so the two never disagree — and so the rule that a row holds no
 * student data is enforced by construction: there is no field here that could
 * carry a name, and nothing to print one from.
 */
export function describeActivity(entry: ActivityEntry): ActivityWording {
  switch (entry.kind) {
    case 'export-session':
      return {
        action: 'Exported this session',
        detail: `${entry.filename ?? ''}, ${delivered(entry)}`,
      };
    case 'export-all':
      return {
        action: entry.scope === 'subtree' ? 'Exported all history, with descendants' : 'Exported all history',
        detail: `${count(entry.taps, 'tap')} from ${count(entry.sessions, 'session')}${acrossBodies(entry)} — ${entry.filename ?? ''}, ${delivered(entry)}`,
      };
    case 'export-range':
      return {
        action: entry.scope === 'subtree' ? 'Exported a date range, with descendants' : 'Exported a date range',
        detail: `${
          entry.rangeFrom && entry.rangeTo
            ? entry.rangeFrom === entry.rangeTo
              ? formatSessionDateLabel(entry.rangeFrom)
              : `${formatSessionDateLabel(entry.rangeFrom)} – ${formatSessionDateLabel(entry.rangeTo)}`
            : 'A date range'
        }: ${count(entry.taps, 'tap')} from ${count(entry.sessions, 'session')}${acrossBodies(entry)} — ${entry.filename ?? ''}, ${delivered(entry)}`,
      };
    case 'export-roster':
      return {
        action: 'Exported the roster',
        detail: `${count(entry.students, 'student')} — ${entry.filename ?? ''}, ${delivered(entry)}`,
      };
    case 'import-roster':
      return {
        action: 'Imported a roster',
        detail: `${count(entry.added, 'student')} added, ${entry.updated ?? 0} updated, ${entry.skipped ?? 0} unchanged, ${entry.rejected ?? 0} refused`,
      };
    case 'remove-student':
      return {
        action: 'Removed a student',
        detail: `${count(entry.taps, 'tap')} from ${count(entry.sessions, 'session')}`,
      };
    case 'purge-history':
      return {
        action: 'Deleted attendance',
        detail: `${count(entry.taps, 'tap')} from ${count(entry.sessions, 'session')} before ${
          entry.before ? formatSessionDateLabel(entry.before) : 'the school year'
        }`,
      };
    case 'remove-alumni':
      return {
        action: 'Removed graduated students',
        detail: `${count(entry.students, 'student')} and ${count(entry.taps, 'tap')}`,
      };
    case 'pin-set':
      return { action: 'Teacher PIN set', detail: '' };
    case 'pin-changed':
      return { action: 'Teacher PIN changed', detail: '' };
    case 'pin-disabled':
      return { action: 'PIN turned off', detail: '' };
    case 'pin-enabled':
      return { action: 'PIN turned on', detail: '' };
    case 'body-reparent':
      return { action: 'Moved a body in the tree', detail: '' };
    case 'body-archive':
      return { action: 'Archived a body', detail: '' };
    case 'body-switch':
      return {
        action: 'Switched on the scanner',
        detail: `${entry.fromBodyName ?? 'Unknown'} → ${entry.toBodyName ?? 'Unknown'}`,
      };
    case 'switch-pin-enabled':
      return { action: 'PIN to switch periods turned on', detail: '' };
    case 'switch-pin-disabled':
      return { action: 'PIN to switch periods turned off', detail: '' };
  }
}
