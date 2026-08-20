interface EdgeLineProps {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  dimmed: boolean;
}

export function EdgeLine({ x1, y1, x2, y2, dimmed }: EdgeLineProps) {
  return (
    <line
      x1={x1}
      y1={y1}
      x2={x2}
      y2={y2}
      stroke="var(--border)"
      strokeWidth={1}
      strokeDasharray={dimmed ? '4 4' : undefined}
      opacity={dimmed ? 0.3 : 0.6}
    />
  );
}
