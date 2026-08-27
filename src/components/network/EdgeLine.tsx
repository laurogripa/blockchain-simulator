interface EdgeLineProps {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export function EdgeLine({ x1, y1, x2, y2 }: EdgeLineProps) {
  return <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--border)" strokeWidth={1} opacity={0.6} />;
}
