import { useCallback, useEffect, useRef, useState } from 'react';
import { clearScans, listScans, saveScan, type AttendanceScan } from '@/data/attendance-store';
import { isValidUid, normalizeUid } from '@/lib/scan-format';

export type ScanFeedback = 'ready' | 'valid' | 'duplicate' | 'invalid';

export function useScannerSession() {
  const [scans, setScans] = useState<AttendanceScan[]>([]);
  const [feedback, setFeedback] = useState<ScanFeedback>('ready');
  const [lastUid, setLastUid] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const resetTimer = useRef<number | undefined>(undefined);
  const pendingUids = useRef(new Set<string>());

  useEffect(() => {
    let mounted = true;
    listScans()
      .then((savedScans) => {
        if (mounted) setScans(savedScans);
      })
      .catch(() => {
        if (mounted) setStorageError(true);
      })
      .finally(() => {
        if (mounted) setIsLoading(false);
      });
    return () => {
      mounted = false;
      if (resetTimer.current) window.clearTimeout(resetTimer.current);
    };
  }, []);

  const announce = useCallback((nextFeedback: ScanFeedback) => {
    setFeedback(nextFeedback);
    if (resetTimer.current) window.clearTimeout(resetTimer.current);
    resetTimer.current = window.setTimeout(() => setFeedback('ready'), 3200);
  }, []);

  const registerScan = useCallback(async (input: string) => {
    const uid = normalizeUid(input);
    if (!isValidUid(uid)) {
      announce('invalid');
      return;
    }

    const alreadyScanned = scans.some((scan) => scan.uid === uid) || pendingUids.current.has(uid);
    setLastUid(uid);
    if (alreadyScanned) {
      announce('duplicate');
      return;
    }

    const scan = { uid, scannedAt: new Date().toISOString() };
    pendingUids.current.add(uid);
    setIsSaving(true);
    try {
      await saveScan(scan);
      setScans((current) => [scan, ...current]);
      setStorageError(false);
      announce('valid');
    } catch {
      setStorageError(true);
      announce('invalid');
    } finally {
      pendingUids.current.delete(uid);
      setIsSaving(false);
    }
  }, [announce, scans]);

  const resetSession = useCallback(async () => {
    await clearScans();
    setScans([]);
    setLastUid('');
    announce('ready');
  }, [announce]);

  return {
    scans,
    count: scans.length,
    feedback,
    lastUid,
    isLoading,
    isSaving,
    storageError,
    registerScan,
    resetSession,
  };
}