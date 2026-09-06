import { AlertTriangle, Check, ScanLine, UserRound } from 'lucide-react';
import type { ScanFeedback } from '@/scanner/use-attendance-session';

type StatusIconProps = {
  feedback: ScanFeedback;
};

export function StatusIcon({ feedback }: StatusIconProps) {
  if (feedback === 'valid' || feedback === 'enrolled' || feedback === 'updated') {
    return <Check aria-hidden="true" size={28} strokeWidth={2.5} />;
  }
  if (
    feedback === 'duplicate' ||
    feedback === 'invalid' ||
    feedback === 'storage-error'
  ) {
    return <AlertTriangle aria-hidden="true" size={28} strokeWidth={2.25} />;
  }
  if (
    feedback === 'existing' ||
    feedback === 'enrollment' ||
    feedback === 'editing'
  ) {
    return <UserRound aria-hidden="true" size={28} strokeWidth={1.9} />;
  }
  return <ScanLine aria-hidden="true" size={28} strokeWidth={1.9} />;
}