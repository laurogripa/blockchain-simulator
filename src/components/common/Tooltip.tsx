import { cloneElement, isValidElement, useState, type MouseEvent, type ReactElement } from 'react';
import { createPortal } from 'react-dom';

interface TooltipProps {
  text: string;
  children: ReactElement;
}

/**
 * Wraps a single child (HTML or SVG) with a hover tooltip carrying raw hex/data — the only
 * text in the app. Clones the child instead of adding a wrapper element so it stays valid
 * inside an <svg> (a wrapping <span> there gets silently dropped by the browser).
 */
export function Tooltip({ text, children }: TooltipProps) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  if (!isValidElement(children)) return children;

  const origProps = children.props as { onMouseMove?: (e: MouseEvent) => void; onMouseLeave?: (e: MouseEvent) => void };
  const child = cloneElement(children as ReactElement<Record<string, unknown>>, {
    onMouseMove: (e: MouseEvent) => {
      setPos({ x: e.clientX + 14, y: e.clientY + 14 });
      origProps.onMouseMove?.(e);
    },
    onMouseLeave: (e: MouseEvent) => {
      setPos(null);
      origProps.onMouseLeave?.(e);
    },
  });

  return (
    <>
      {child}
      {pos &&
        createPortal(
          <div className="tooltip" style={{ left: pos.x, top: pos.y }}>
            {text}
          </div>,
          document.body,
        )}
    </>
  );
}
