'use client';

export function BottomInfo({ className }: { className?: string }) {
  const year = new Date().getFullYear();
  return (
    <div className={className ? `gvaBottomInfo ${className}` : 'gvaBottomInfo'}>
      <p className="text-center">
        Powered by{' '}
        <a href="https://www.gin-vue-admin.com" target="_blank" rel="noreferrer">
          Gin-Vue-Admin
        </a>
      </p>
      <div className="gvaLoginFooterLinks links">
        <a href="https://support.qq.com/product/371961" target="_blank" rel="noreferrer" title="客服">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/gva-support.png" className="footer-icon" alt="客服" />
        </a>
        <a href="https://space.bilibili.com/322210472" target="_blank" rel="noreferrer" title="视频">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/gva-video.png" className="footer-icon" alt="视频站" />
        </a>
        <a href="https://www.gin-vue-admin.com/" target="_blank" rel="noreferrer" title="文档">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/gva-docs.png" className="footer-icon" alt="文档" />
        </a>
        <a
          href="https://github.com/flipped-aurora/gin-vue-admin"
          target="_blank"
          rel="noreferrer"
          title="GitHub"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/gva-github.png" className="footer-icon" alt="GitHub" />
        </a>
      </div>
      <p className="text-center">
        Copyright © {year} flipped-aurora团队
      </p>
    </div>
  );
}
