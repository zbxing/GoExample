'use client';

import { RefreshCw, TriangleAlert } from 'lucide-react';
import { useEffect } from 'react';

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('MSFront page rendering failed.', error);
  }, [error]);

  return (
    <main className="routeState" role="alert">
      <TriangleAlert aria-hidden="true" size={28} />
      <h1>页面暂时无法加载</h1>
      <p>请求未能完成，请稍后重试。</p>
      <button className="routeStateAction" type="button" onClick={reset}>
        <RefreshCw aria-hidden="true" size={16} />
        重新加载
      </button>
    </main>
  );
}
