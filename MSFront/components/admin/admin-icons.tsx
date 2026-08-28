import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function baseProps({ size = 14, className, ...rest }: IconProps) {
  return {
    className,
    width: size,
    height: size,
    viewBox: '0 0 1024 1024',
    'aria-hidden': true as const,
    ...rest,
  };
}

export function IconSearch(props: IconProps) {
  return (
    <svg {...baseProps(props)}>
      <path
        fill="currentColor"
        d="M795.904 750.72l124.992 124.928a32 32 0 01-45.248 45.248L750.656 795.904a416 416 0 1145.248-45.248zM480 832a352 352 0 100-704 352 352 0 000 704z"
      />
    </svg>
  );
}

export function IconRefresh(props: IconProps) {
  return (
    <svg {...baseProps(props)}>
      <path
        fill="currentColor"
        d="M771.8 794.9A384 384 0 01128 512h64a320 320 0 00555.7 216.4h-93a32 32 0 110-64h149a32 32 0 0132 32v149a32 32 0 11-64 0zM276.3 295.6h93a32 32 0 010 64H220.2a32 32 0 01-32-32v-149a32 32 0 0164 0V229a384 384 0 01644 282.9h-64a320 320 0 00-555.8-216.4z"
      />
    </svg>
  );
}

export function IconPlus(props: IconProps) {
  return (
    <svg {...baseProps(props)}>
      <path
        fill="currentColor"
        d="M480 480V128a32 32 0 0164 0v352h352a32 32 0 110 64H544v352a32 32 0 11-64 0V544H128a32 32 0 010-64h352z"
      />
    </svg>
  );
}

export function IconDelete(props: IconProps) {
  return (
    <svg {...baseProps(props)}>
      <path
        fill="currentColor"
        d="M160 256H96a32 32 0 010-64h256V96a32 32 0 0132-32h256a32 32 0 0132 32v96h256a32 32 0 110 64h-64v672a32 32 0 01-32 32H192a32 32 0 01-32-32zm448-64v-64H416v64zM224 896h576V256H224zm192-128a32 32 0 01-32-32V416a32 32 0 0164 0v320a32 32 0 01-32 32m192 0a32 32 0 01-32-32V416a32 32 0 0164 0v320a32 32 0 01-32 32"
      />
    </svg>
  );
}

export function IconEdit(props: IconProps) {
  return (
    <svg {...baseProps(props)}>
      <path
        fill="currentColor"
        d="M832 512a32 32 0 0180 0v352a112 112 0 01-112 112H224A112 112 0 01112 864V192A112 112 0 01224 80h352a32 32 0 010 64H224a48 48 0 00-48 48v672a48 48 0 0048 48h576a48 48 0 0048-48V512zM761.344 177.344a32 32 0 0145.312 0l90.496 90.496a32 32 0 010 45.312L433.28 777.216a32 32 0 01-15.36 8.448L247.744 816a32 32 0 01-39.232-39.232l30.336-170.176a32 32 0 018.448-15.36L761.344 177.344zm22.656 67.968L365.696 663.616l-16.128 90.496 90.496-16.128L851.968 290.88 784 222.912z"
      />
    </svg>
  );
}

export function IconUser(props: IconProps) {
  return (
    <svg {...baseProps(props)}>
      <path
        fill="currentColor"
        d="M512 512a192 192 0 100-384 192 192 0 000 384m0 64a256 256 0 110-512 256 256 0 010 512m320 320v-96a96 96 0 00-96-96H288a96 96 0 00-96 96v96a32 32 0 11-64 0v-96a160 160 0 01160-160h448a160 160 0 01160 160v96a32 32 0 11-64 0"
      />
    </svg>
  );
}

export function IconWarningFilled(props: IconProps) {
  return (
    <svg {...baseProps(props)}>
      <path
        fill="currentColor"
        d="M512 64a448 448 0 110 896 448 448 0 010-896m0 192a58.4 58.4 0 00-58.2 63.7L477 576.1a35 35 0 0069.8 0l23.3-256.4A58.4 58.4 0 00512 256m0 512a51.2 51.2 0 110-102.4 51.2 51.2 0 010 102.4"
      />
    </svg>
  );
}


export function IconCompass(props: IconProps) {
  return (
    <svg {...baseProps(props)}>
      <path
        fill="currentColor"
        d="M512 896a384 384 0 100-768 384 384 0 000 768m0 64a448 448 0 110-896 448 448 0 010 896"
      />
      <path
        fill="currentColor"
        d="M725.9 315q-74.1 170.6-157.3 253.6Q485.5 652 315 726a12.8 12.8 0 01-16.9-16.9q74.3-170.6 157.3-253.6t253.7-157.3a12.8 12.8 0 0116.8 16.8"
      />
    </svg>
  );
}

export function IconDownload(props: IconProps) {
  return (
    <svg {...baseProps(props)}>
      <path
        fill="currentColor"
        d="M160 832h704a32 32 0 110 64H160a32 32 0 110-64m384-253.7L780.3 342l45.2 45.2L508.8 704 192 387.2l45.2-45.2L480 584.7V128h64z"
      />
    </svg>
  );
}

export function IconUpload(props: IconProps) {
  return (
    <svg {...baseProps(props)}>
      <path
        fill="currentColor"
        d="M160 832h704a32 32 0 110 64H160a32 32 0 110-64m384-578.3V704h-64V247.3L237.2 490 192 444.8 508.8 128l316.8 316.8-45.3 45.2z"
      />
    </svg>
  );
}

export function IconArrowLeft(props: IconProps) {
  return (
    <svg {...baseProps({ size: 12, ...props })}>
      <path
        fill="currentColor"
        d="M609.408 104.96l-45.696-45.696L144.96 512l418.752 452.736 45.696-45.696L236.352 512z"
      />
    </svg>
  );
}

export function IconArrowRight(props: IconProps) {
  return (
    <svg {...baseProps({ size: 12, ...props })}>
      <path
        fill="currentColor"
        d="M414.592 104.96l45.696-45.696L879.04 512 460.288 964.736l-45.696-45.696L787.648 512z"
      />
    </svg>
  );
}

/** Element Plus / Ant Design tree caret：实心三角（折叠向右，展开旋转 90° 向下） */
export function IconCaretRight(props: IconProps) {
  return (
    <svg {...baseProps({ size: 12, ...props })}>
      <path fill="currentColor" d="M384 192v640l384-320.064z" />
    </svg>
  );
}

export function IconArrowDown(props: IconProps) {
  return (
    <svg {...baseProps({ size: 12, ...props })}>
      <path
        fill="currentColor"
        d="M831.872 340.864L512 652.672 192.128 340.864a30.592 30.592 0 00-42.752 0 29.12 29.12 0 000 41.6L489.664 714.24a32 32 0 0044.672 0l340.288-331.712a29.12 29.12 0 000-41.728 30.592 30.592 0 00-42.752 0z"
      />
    </svg>
  );
}

export function IconSetting(props: IconProps) {
  return (
    <svg {...baseProps(props)}>
      <path
        fill="currentColor"
        d="M764.8 360.96l-54.4-93.76a32 32 0 00-43.84-11.52l-71.36 41.28a256.64 256.64 0 00-82.24 0l-71.36-41.28a32 32 0 00-43.84 11.52l-54.4 93.76a32 32 0 004.16 38.4l57.28 62.08a255.36 255.36 0 000 82.24l-57.28 62.08a32 32 0 00-4.16 38.4l54.4 93.76a32 32 0 0043.84 11.52l71.36-41.28a256.64 256.64 0 0082.24 0l71.36 41.28a32 32 0 0043.84-11.52l54.4-93.76a32 32 0 00-4.16-38.4l-57.28-62.08a255.36 255.36 0 000-82.24l57.28-62.08a32 32 0 004.16-38.4zM512 640a128 128 0 110-256 128 128 0 010 256z"
      />
    </svg>
  );
}

export function IconCopy(props: IconProps) {
  return (
    <svg {...baseProps(props)}>
      <path
        fill="currentColor"
        d="M768 832a128 128 0 01-128 128H192A128 128 0 0164 832V384a128 128 0 01128-128v64a64 64 0 00-64 64v448a64 64 0 0064 64h448a64 64 0 0064-64zM384 128a64 64 0 00-64 64v448a64 64 0 0064 64h448a64 64 0 0064-64V192a64 64 0 00-64-64zm0-64h448a128 128 0 01128 128v448a128 128 0 01-128 128H384a128 128 0 01-128-128V192A128 128 0 01384 64z"
      />
    </svg>
  );
}
