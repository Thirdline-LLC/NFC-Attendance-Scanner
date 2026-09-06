import { AlertTriangle, Check, ScanLine } from 'lucide-react';
import type { ScanFeedback } from '@/scanner/use-scanner-session';

type StatusIconProps = {
  feedback: ScanFeedback;
};

export function StatusIcon({ feedback }: StatusIconProps) {
  if (feedback === 'valid') {
    return <Check aria-hidden="true" size={28} strokeWidth={2.5} />;
  }
  if (feedback === 'duplicate' || feedback === 'invalid') {
    return <AlertTriangle aria-hidden="true" size={28} strokeWidth={2.25} />;
  }
  return <ScanLine aria-hidden="true" size={28} strokeWidth={1.9} />;
}