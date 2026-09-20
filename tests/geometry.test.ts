import { describe, expect, it } from 'vitest';
import { geometryIsUsable, geometryToSvgPoints, normalizePoint, normalizePolygon, normalizeRect } from '../src/geometry';

describe('region geometry', () => {
  it('clamps points and normalizes a rectangle regardless of drag direction', () => {
    expect(normalizePoint({ x: -1, y: 2 })).toEqual({ x: 0, y: 1 });
    expect(normalizeRect({ x: 0.8, y: 0.7 }, { x: 0.2, y: 0.1 })).toEqual({ type: 'rect', x: 0.2, y: 0.1, width: 0.6, height: 0.6 });
  });

  it('normalizes polygon points and emits SVG coordinates', () => {
    const polygon = normalizePolygon([{ x: 0, y: 0 }, { x: 1.2, y: 0.4 }, { x: 0.5, y: -1 }]);
    expect(polygon).toEqual({ type: 'polygon', points: [{ x: 0, y: 0 }, { x: 1, y: 0.4 }, { x: 0.5, y: 0 }] });
    expect(geometryToSvgPoints(polygon.points)).toBe('0,0 1,0.4 0.5,0');
  });

  it('rejects degenerate shapes before create is called', () => {
    expect(geometryIsUsable(normalizeRect({ x: 0, y: 0 }, { x: 0.0001, y: 0.5 }))).toBe(false);
    expect(geometryIsUsable({ type: 'polygon', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] })).toBe(false);
    expect(geometryIsUsable({ type: 'polygon', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] })).toBe(true);
  });
});
