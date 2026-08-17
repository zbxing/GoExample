import { Home, SearchX } from 'lucide-react';
import Link from 'next/link';

export default function NotFoundPage() {
  return (
    <main className="routeState">
      <SearchX aria-hidden="true" size={28} />
      <h1>页面不存在</h1>
      <p>该地址可能已变更或不再可用。</p>
      <Link className="routeStateAction" href="/dashboard">
        <Home aria-hidden="true" size={16} />
        返回控制台
      </Link>
    </main>
  );
}
