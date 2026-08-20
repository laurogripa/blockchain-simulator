import { useEffect, useRef, useState } from 'react';
import { engine } from '../engine/engine';
import { useSimStore } from '../store/useSimStore';

export interface AnimatedPacket {
  id: string;
  x: number;
  y: number;
  kind: string;
}

/** Own rAF loop: interpolates packet positions from engine.simNow, scoped to whoever calls this. */
export function useAnimatedPackets(nodePos: Record<string, { x: number; y: number }>): AnimatedPacket[] {
  const packets = useSimStore((s) => s.packets);
  const [frame, setFrame] = useState<AnimatedPacket[]>([]);
  const rafRef = useRef(0);

  useEffect(() => {
    const tick = () => {
      const now = engine?.simNow ?? 0;
      const next: AnimatedPacket[] = packets.map((p) => {
        const from = nodePos[p.from];
        const to = nodePos[p.to];
        if (!from || !to) return { id: p.id, x: 0, y: 0, kind: p.kind };
        const span = Math.max(1, p.arrivesAt - p.sentAt);
        const t = Math.min(1, Math.max(0, (now - p.sentAt) / span));
        return { id: p.id, x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, kind: p.kind };
      });
      setFrame(next);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [packets, nodePos]);

  return frame;
}
