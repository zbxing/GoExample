'use client';

export function BottomInfo({ className }: { className?: string }) {
  return (
    <div className={className ? `fnaBottomInfo ${className}` : 'fnaBottomInfo'}>
      <p className="text-center fnaBottomPowered">
        POWERED BY <span className="fnaBottomBrand">FNA</span>
      </p>
    </div>
  );
}
