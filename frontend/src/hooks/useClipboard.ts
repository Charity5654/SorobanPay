import { useCallback, useEffect, useRef, useState } from 'react';

export type ClipboardStatus = 'idle' | 'copied' | 'error';

export function useClipboard(resetAfterMs = 2000) {
  const [status, setStatus] = useState<ClipboardStatus>('idle');
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copy = useCallback(async (text: string): Promise<boolean> => {
    if (resetTimer.current) clearTimeout(resetTimer.current);
    setStatus('idle');

    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(text);
      setStatus('copied');
      resetTimer.current = setTimeout(() => setStatus('idle'), resetAfterMs);
      return true;
    } catch {
      setStatus('error');
      resetTimer.current = setTimeout(() => setStatus('idle'), resetAfterMs);
      return false;
    }
  }, [resetAfterMs]);

  useEffect(() => () => {
    if (resetTimer.current) clearTimeout(resetTimer.current);
  }, []);

  return { copy, status };
}