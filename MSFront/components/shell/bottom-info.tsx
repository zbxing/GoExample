'use client';

export function BottomInfo({ className }: { className?: string }) {
  return (
    <div className={className ? `gvaBottomInfo ${className}` : 'gvaBottomInfo'}>
      <p className="text-center gvaBottomPowered">
        POWERED BY <span className="gvaBottomBrand">EXAMPLE</span>
      </p>
    </div>
  );
}
