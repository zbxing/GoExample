import { LoaderCircle } from 'lucide-react';

export default function LoadingPage() {
  return (
    <main className="routeState" aria-live="polite" aria-busy="true">
      <LoaderCircle className="routeStateSpinner" aria-hidden="true" size={28} />
      <p>正在加载</p>
    </main>
  );
}
