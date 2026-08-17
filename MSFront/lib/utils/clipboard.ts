'use client';

export async function copyTextToClipboard(text: string) {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new Error('Clipboard is unavailable on the server.');
  }

  if (
    typeof navigator !== 'undefined' &&
    window.isSecureContext &&
    typeof navigator.clipboard?.writeText === 'function'
  ) {
    await navigator.clipboard.writeText(text);
    return;
  }

  if (copyTextWithExecCommand(text)) {
    return;
  }

  throw new Error('Clipboard copy failed.');
}

function copyTextWithExecCommand(text: string) {
  const activeElement =
    document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const selection = window.getSelection();
  const originalRange =
    selection && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;
  const textarea = document.createElement('textarea');

  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.top = '0';
  textarea.style.left = '-9999px';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';

  document.body.append(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  let copied = false;

  try {
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  } finally {
    textarea.remove();

    if (selection) {
      selection.removeAllRanges();

      if (originalRange) {
        selection.addRange(originalRange);
      }
    }

    activeElement?.focus();
  }

  return copied;
}
