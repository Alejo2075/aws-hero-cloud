import type { CSSProperties } from 'react';

const paths = {
  cloud: 'M5 3h6v1h2v2h2v1h1v5h-1v1H1v-1H0V8h1V6h3V4h1V3zm1 2v1H5v2H2v3h12V8h-3V6h-1V5H6z',
  folder: 'M1 3h5v1h9v2h1v7H0V3h1zm1 3v5h12V6H2z',
  plan: 'M3 0h8v1h2v2h1v13H2V0h1zm1 2v12h8V4H9V2H4zm1 4h5v2H5V6zm0 4h5v2H5v-2z',
  check: 'M13 3h2v3h-2v2h-2v2H9v2H7v2H5v-2H3v-2H1V7h2v1h2v2h2V8h2V6h2V4h2V3z',
  arrow: 'M8 2h2v2h2v2h2v1h2v2h-2v1h-2v2h-2v2H8v-3h2V9H0V7h10V5H8V2z',
  star: 'M7 0h2v5h2V3h2v2h-2v2h5v2h-5v2h2v2h-2v-2H9v5H7v-5H5v2H3v-2h2V9H0V7h5V5H3V3h2v2h2V0z',
  copy: 'M5 0h10v12h-3v4H0V4h5V0zm2 2v2h5v6h1V2H7zM2 6v8h8V6H2z',
  code: 'M4 3h2v2H4v2H2v2h2v2h2v2H4v-2H2V9H0V7h2V5h2V3zm6 0h2v2h2v2h2v2h-2v2h-2v2h-2v-2h2V9h2V7h-2V5h-2V3z',
  heart: 'M2 2h4v1h1v1h2V3h1V2h4v1h1v1h1v5h-2v2h-2v2h-2v2H6v-2H4v-2H2V9H0V4h1V3h1V2z',
  menu: 'M1 2h14v2H1V2zm0 5h14v2H1V7zm0 5h14v2H1v-2z',
  close:
    'M2 1h2v2h2v2h2v2h2V5h2V3h2V1h2v3h-2v2h-2v2h-2v2h2v2h2v2h2v2h-3v-2h-2v-2H9v-2H7v2H5v2H3v2H1v-3h2v-2h2V9h2V7H5V5H3V3H2V1z',
} as const;

export function Icon({
  name,
  className = '',
  style,
}: {
  readonly name: keyof typeof paths;
  readonly className?: string;
  readonly style?: CSSProperties;
}) {
  return (
    <svg
      className={`icon ${className}`}
      style={style}
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      shapeRendering="crispEdges"
    >
      <path d={paths[name]} />
    </svg>
  );
}
