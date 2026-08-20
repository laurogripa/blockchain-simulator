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

  // Keep latest packets/nodePos in refs so the rAF loop below can be set up once
  // (on mount) instead of being torn down and restarted whenever these identities
  // change — which, since positions/packets are freshly allocated on most renders,
  // used to happen almost every frame and made the animation stutter.
  const packetsRef = useRef(packets);
  packetsRef.current = packets;
  const nodePosRef = useRef(nodePos);
  nodePosRef.current = nodePos;

  useEffect(() => {
    const tick = () => {
      const now = engine?.simNow ?? 0;
      const next: AnimatedPacket[] = packetsRef.current.map((p) => {
        const from = nodePosRef.current[p.from];
        const to = nodePosRef.current[p.to];
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
  }, []);

  return frame;
}
