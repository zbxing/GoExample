'use client';

import { useEffect, useState } from 'react';
import type { FeedbackState } from '@/components/common/feedback-banner';

const defaultDurationMs = 3200;

export function useFeedback(options?: { durationMs?: number }) {
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const durationMs = options?.durationMs ?? defaultDurationMs;

  useEffect(() => {
    if (!feedback) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setFeedback(null);
    }, durationMs);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [durationMs, feedback]);

  return {
    feedback,
    clearFeedback() {
      setFeedback(null);
    },
    showFeedback(nextFeedback: FeedbackState) {
      setFeedback(nextFeedback);
    },
    showSuccess(message: string) {
      setFeedback({ tone: 'success', message });
    },
    showError(message: string) {
      setFeedback({ tone: 'error', message });
    },
    showInfo(message: string) {
      setFeedback({ tone: 'info', message });
    },
  };
}
