'use client';

import { AlertCircle, CheckCircle2, Info } from 'lucide-react';

export interface FeedbackState {
  tone: 'success' | 'error' | 'info';
  message: string;
}

interface FeedbackBannerProps {
  feedback: FeedbackState | null;
  className?: string;
}

export function FeedbackBanner({ feedback, className = '' }: FeedbackBannerProps) {
  if (!feedback) {
    return null;
  }

  const Icon =
    feedback.tone === 'success'
      ? CheckCircle2
      : feedback.tone === 'error'
        ? AlertCircle
        : Info;

  const liveRole = feedback.tone === 'error' ? 'alert' : 'status';
  const liveMode = feedback.tone === 'error' ? 'assertive' : 'polite';
  const classes = ['feedbackBanner', `feedbackBanner-${feedback.tone}`, className]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classes} role={liveRole} aria-live={liveMode}>
      <Icon size={16} />
      <p>{feedback.message}</p>
    </div>
  );
}
