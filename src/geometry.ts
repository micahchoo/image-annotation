import type { Geometry, Point } from './types';

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

export function normalizePoint(point: Point): Point {
  return { x: clamp01(point.x), y: clamp01(point.y) };
}

export function normalizeRect(start: Point, end: Point): Extract<Geometry, { type: 'rect' }> {
  const a = normalizePoint(start);
  const b = normalizePoint(end);
  return {
    type: 'rect',
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Number(Math.abs(a.x - b.x).toFixed(6)),
    height: Number(Math.abs(a.y - b.y).toFixed(6)),
  };
}

export function normalizePolygon(points: Point[]): Extract<Geometry, { type: 'polygon' }> {
  return { type: 'polygon', points: points.map(normalizePoint) };
}

export function geometryIsUsable(geometry: Geometry): boolean {
  if (geometry.type === 'rect') {
    return geometry.width > 0.001 && geometry.height > 0.001;
  }
  if (geometry.points.length < 3) return false;
  let doubledArea = 0;
  for (let index = 0; index < geometry.points.length; index += 1) {
    const point = geometry.points[index];
    const next = geometry.points[(index + 1) % geometry.points.length];
    doubledArea += point.x * next.y - next.x * point.y;
  }
  return Math.abs(doubledArea) > 0.001;
}

export function geometryToSvgPoints(points: Point[]): string {
  return points.map((point) => `${point.x},${point.y}`).join(' ');
}
