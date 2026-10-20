import type { CharacterFrameRequest, Sprite } from '../../art/api';

type ResidentSpriteKind = 'pet';
const cache = new Map<string, Sprite>();

function pixel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

/**
 * Native renderer sprite for the family cat.  It returns the same Sprite
 * contract used by Habblaud's procedural character art; movement, depth,
 * collision and animation timing still belong to the native Renderer/Sim.
 */
export function zhugeResidentSprite(kind: ResidentSpriteKind, request: Pick<CharacterFrameRequest, 'dir' | 'pose'>, animT: number): Sprite | null {
  if (kind !== 'pet' || typeof document === 'undefined') return null;
  const frame = request.pose === 'walk' || request.pose === 'run' ? Math.floor(animT / 150) % 4 : Math.floor(animT / 520) % 2;
  const key = `${kind}|${request.dir}|${request.pose}|${frame}`;
  const existing = cache.get(key);
  if (existing) return existing;

  const canvas = document.createElement('canvas');
  canvas.width = 28;
  canvas.height = 23;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = false;

  const fur = '#4a4f5a';
  const furLight = '#747b87';
  const furDark = '#292d35';
  const eye = '#e8c85b';
  const nose = '#df9aa6';
  const tailLift = frame % 2 === 0 ? 0 : -2;

  // Body and haunches.
  pixel(ctx, 7, 10, 14, 8, furDark);
  pixel(ctx, 9, 8, 11, 8, fur);
  pixel(ctx, 6, 13, 4, 5, fur);
  pixel(ctx, 19, 13, 4, 5, furLight);
  // Head and pointed ears.
  pixel(ctx, 7, 4, 13, 9, fur);
  pixel(ctx, 8, 2, 4, 4, furDark);
  pixel(ctx, 16, 2, 4, 4, furDark);
  pixel(ctx, 9, 4, 2, 2, furLight);
  pixel(ctx, 17, 4, 2, 2, furLight);
  // Face is directional but remains recognisable at every native heading.
  const faceX = request.dir === 'left' ? 7 : request.dir === 'right' ? 17 : 12;
  pixel(ctx, faceX, 7, 2, 2, eye);
  pixel(ctx, faceX + (request.dir === 'left' ? -2 : request.dir === 'right' ? 2 : 4), 7, 2, 2, eye);
  pixel(ctx, request.dir === 'left' ? 6 : request.dir === 'right' ? 20 : 13, 10, 2, 2, nose);
  // Paws animate with the native walk pose; sitting/resting keeps them planted.
  const pawOffset = request.pose === 'walk' || request.pose === 'run' ? (frame % 2 ? 1 : -1) : 0;
  pixel(ctx, 8 + pawOffset, 17, 3, 4, furLight);
  pixel(ctx, 17 - pawOffset, 17, 3, 4, furLight);
  // Curved tail, with a small native frame animation.
  pixel(ctx, 20, 10 + tailLift, 4, 3, furLight);
  pixel(ctx, 23, 7 + tailLift, 3, 4, fur);
  pixel(ctx, 24, 5 + tailLift, 2, 3, furDark);

  const sprite: Sprite = { canvas, ax: 14, ay: 20 };
  cache.set(key, sprite);
  return sprite;
}
