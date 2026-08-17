import { Suspense } from 'react';
import { LoginPageContent } from '@/components/pages/login-page-content';

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="loginPage"><div className="loginPanel">加载中…</div></div>}>
      <LoginPageContent />
    </Suspense>
  );
}
