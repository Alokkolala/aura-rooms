import { useEffect, useRef } from 'react';
import { TILE, PAL, sprites } from './sprites.ts';
import type { EntityState, Level } from '../engine/types.ts';

/**
 * Canvas renderer for one room.
 *
 * Animation is pure replay: the engine has already computed the whole step and
 * handed us `path`, the list of poses it passed through. Nothing here can
 * influence the simulation — the worst a rendering bug can do is show the wrong
 * picture of an outcome that is already decided.
 */

const WALK_MS = 130;
const SLIDE_MS = 55; // carried movement reads faster than a deliberate step
const TURN_MS = 90;

export interface RoomProps {
  level: Level;
  path: EntityState[];
  /** changes whenever a new step should start animating */
  animToken: number;
  highlight: { x: number; y: number } | null;
  celebrate: boolean;
  onDone?: () => void;
}

function segMs(a: EntityState, b: EntityState, isSlide: boolean) {
  if (a.x === b.x && a.y === b.y) return TURN_MS;
  return isSlide ? SLIDE_MS : WALK_MS;
}

export function Room({ level, path, animToken, highlight, celebrate, onDone }: RoomProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const done = useRef(false);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    const S = sprites();

    const poses = path.length ? path : [level.start];
    // Anything after the first actual displacement is carried movement.
    let firstMoveIdx = -1;
    for (let i = 1; i < poses.length; i++)
      if (poses[i].x !== poses[i - 1].x || poses[i].y !== poses[i - 1].y) {
        firstMoveIdx = i;
        break;
      }

    const durations = poses.slice(1).map((p, i) =>
      segMs(poses[i], p, firstMoveIdx >= 0 && i + 1 > firstMoveIdx),
    );
    const total = durations.reduce((a, b) => a + b, 0);

    done.current = false;
    let raf = 0;
    const t0 = performance.now();

    const draw = (now: number) => {
      const elapsed = now - t0;
      const scale = cv.width / (level.w * TILE);

      ctx.fillStyle = PAL.void;
      ctx.fillRect(0, 0, cv.width, cv.height);

      ctx.save();
      ctx.scale(scale, scale);
      for (let y = 0; y < level.h; y++)
        for (let x = 0; x < level.w; x++)
          ctx.drawImage(S.tiles[level.grid[y][x]], x * TILE, y * TILE);

      if (highlight) {
        ctx.strokeStyle = celebrate ? PAL.ringA : PAL.fin;
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.55 + 0.45 * Math.sin(elapsed / 140);
        ctx.strokeRect(
          highlight.x * TILE + 0.5,
          highlight.y * TILE + 0.5,
          TILE - 1,
          TILE - 1,
        );
        ctx.globalAlpha = 1;
      }

      // walk the path to the current instant
      let t = elapsed;
      let i = 0;
      while (i < durations.length && t > durations[i]) {
        t -= durations[i];
        i++;
      }
      const a = poses[Math.min(i, poses.length - 1)];
      const b = poses[Math.min(i + 1, poses.length - 1)];
      const k = durations[i] ? Math.min(1, t / durations[i]) : 1;
      const ease = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      const ex = (a.x + (b.x - a.x) * ease) * TILE;
      const ey = (a.y + (b.y - a.y) * ease) * TILE;
      const dir = k > 0.5 ? b.dir : a.dir;

      const settled = elapsed >= total;
      const bob = settled ? (Math.floor(elapsed / 420) % 2 as 0 | 1) : 0;
      // pixel-snap so the sprite never lands on a half pixel
      ctx.drawImage(S.entity[dir][bob], Math.round(ex), Math.round(ey));
      ctx.restore();

      if (settled && !done.current) {
        done.current = true;
        onDone?.();
      }
      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animToken, level, highlight, celebrate]);

  const scale = Math.max(2, Math.min(7, Math.floor(620 / (level.w * TILE))));
  return (
    <canvas
      ref={ref}
      className="room-canvas"
      width={level.w * TILE * scale}
      height={level.h * TILE * scale}
      style={{ width: level.w * TILE * scale, height: level.h * TILE * scale }}
    />
  );
}
