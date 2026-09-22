/**
 * Pure bitmap painting for annotation markers. The caller supplies a raw
 * bitmap (the format `nativeImage.toBitmap()` returns) and the channel order
 * detected at runtime; nothing here imports Electron, so it stays unit
 * testable in Node.
 */

export type ChannelOrder = "bgra" | "rgba";

export type MarkerBounds = { x: number; y: number; width: number; height: number };

export type AnnotationMarker = {
  readonly mode: "element" | "area";
  /** Viewport CSS pixels. */
  readonly bounds: MarkerBounds;
  readonly number: number;
  /** CSS pixels to image pixels. */
  readonly scale: number;
};

const ACCENT = { r: 74, g: 130, b: 255 };
const FILL_ALPHA = { element: 0.14, area: 0.07 };

/** Bitmap budget for one annotation capture; larger displays are scaled to fit. */
const ANNOTATION_MAX_PIXELS = 16_000_000;

/**
 * Chromium's screenshot clip scale multiplies the device-pixel output, so the
 * base capture at `scale: 1` is already CSS pixels times the device pixel
 * ratio. The clip is scaled down only when the native bitmap would exceed the
 * pixel budget; `imageScale` is the factor for mapping CSS coordinates onto
 * the resulting image.
 */
export function annotationCaptureScale(
  cssWidth: number,
  cssHeight: number,
  pixelRatio: number,
): { clipScale: number; imageScale: number } {
  const nativePixels = Math.max(cssWidth * cssHeight, 1) * pixelRatio ** 2;
  const clipScale =
    nativePixels > ANNOTATION_MAX_PIXELS ? Math.sqrt(ANNOTATION_MAX_PIXELS / nativePixels) : 1;
  return { clipScale, imageScale: pixelRatio * clipScale };
}

/** 5x7 bitmaps, most significant of five bits is the leftmost column. */
const DIGITS: readonly (readonly number[])[] = [
  [0b01110, 0b10001, 0b10011, 0b10101, 0b11001, 0b10001, 0b01110],
  [0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  [0b01110, 0b10001, 0b00001, 0b00010, 0b00100, 0b01000, 0b11111],
  [0b11111, 0b00010, 0b00100, 0b00010, 0b00001, 0b10001, 0b01110],
  [0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010],
  [0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110],
  [0b00110, 0b01000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110],
  [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000],
  [0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110],
  [0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00010, 0b01100],
];

/**
 * Identifies which channel holds red from the bitmap of a known red pixel.
 * The byte layout of `toBitmap()` is platform-dependent, so the caller parses
 * a one-pixel reference image instead of assuming an order.
 */
export function detectChannelOrder(bitmap: Buffer): ChannelOrder {
  if (bitmap.length < 4) throw new Error("Reference bitmap is empty.");
  const [first = 0, , third = 0] = bitmap;
  if (first > 128 && third < 128) return "rgba";
  if (third > 128 && first < 128) return "bgra";
  throw new Error("Reference bitmap does not contain a single red pixel.");
}

export function drawAnnotationMarker(
  bitmap: Buffer,
  width: number,
  height: number,
  marker: AnnotationMarker,
  order: ChannelOrder,
): void {
  if (bitmap.length < width * height * 4) throw new Error("Bitmap is smaller than its dimensions.");
  const bounds = {
    x: marker.bounds.x * marker.scale,
    y: marker.bounds.y * marker.scale,
    width: marker.bounds.width * marker.scale,
    height: marker.bounds.height * marker.scale,
  };
  if (!Number.isFinite(bounds.x + bounds.y + bounds.width + bounds.height)) return;
  if (bounds.width <= 0 || bounds.height <= 0) return;
  const thickness = Math.max(2, Math.round(3 * marker.scale));
  const alpha = FILL_ALPHA[marker.mode];
  const painter = createPainter(bitmap, width, height, order);
  // Translucent fill so the marked region reads at a glance without hiding it.
  fillRect(painter, bounds, alpha);
  if (marker.mode === "area") {
    const dash = Math.max(4, Math.round(6 * marker.scale));
    dashRect(painter, bounds, thickness, dash, ACCENT);
  } else {
    strokeRect(painter, bounds, thickness, ACCENT);
  }
  drawBadge(painter, bounds, marker.number, marker.scale);
}

type Painter = {
  readonly width: number;
  readonly height: number;
  readonly order: ChannelOrder;
  readonly bitmap: Buffer;
  pixel(x: number, y: number, color: { r: number; g: number; b: number }, alpha: number): void;
};

function createPainter(
  bitmap: Buffer,
  width: number,
  height: number,
  order: ChannelOrder,
): Painter {
  const pixel = (
    x: number,
    y: number,
    color: { r: number; g: number; b: number },
    alpha: number,
  ) => {
    const px = Math.round(x);
    const py = Math.round(y);
    if (px < 0 || py < 0 || px >= width || py >= height) return;
    const index = (py * width + px) * 4;
    const [r, g, b] =
      order === "bgra"
        ? [bitmap[index + 2] ?? 0, bitmap[index + 1] ?? 0, bitmap[index] ?? 0]
        : [bitmap[index] ?? 0, bitmap[index + 1] ?? 0, bitmap[index + 2] ?? 0];
    const next = {
      r: Math.round(color.r * alpha + r * (1 - alpha)),
      g: Math.round(color.g * alpha + g * (1 - alpha)),
      b: Math.round(color.b * alpha + b * (1 - alpha)),
    };
    if (order === "bgra") {
      bitmap[index] = next.b;
      bitmap[index + 1] = next.g;
      bitmap[index + 2] = next.r;
    } else {
      bitmap[index] = next.r;
      bitmap[index + 1] = next.g;
      bitmap[index + 2] = next.b;
    }
    bitmap[index + 3] = 255;
  };
  return { bitmap, width, height, order, pixel };
}

function fillRect(painter: Painter, rect: MarkerBounds, alpha: number) {
  const left = Math.max(0, Math.floor(rect.x));
  const top = Math.max(0, Math.floor(rect.y));
  const right = Math.min(painter.width, Math.ceil(rect.x + rect.width));
  const bottom = Math.min(painter.height, Math.ceil(rect.y + rect.height));
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) painter.pixel(x, y, ACCENT, alpha);
  }
}

type Edge = { x: number; y: number; length: number; horizontal: boolean };

function rectEdges(rect: MarkerBounds, thickness: number): Edge[] {
  const edges: Edge[] = [];
  const left = Math.floor(rect.x);
  const top = Math.floor(rect.y);
  const right = Math.ceil(rect.x + rect.width);
  const bottom = Math.ceil(rect.y + rect.height);
  const bands = Math.max(1, Math.round(thickness));
  for (let band = 0; band < bands; band++) {
    edges.push({ x: left, y: top + band, length: right - left, horizontal: true });
    edges.push({ x: left, y: bottom - 1 - band, length: right - left, horizontal: true });
    edges.push({ x: left + band, y: top, length: bottom - top, horizontal: false });
    edges.push({ x: right - 1 - band, y: top, length: bottom - top, horizontal: false });
  }
  return edges;
}

function strokeRect(painter: Painter, rect: MarkerBounds, thickness: number, color: typeof ACCENT) {
  for (const edge of rectEdges(rect, thickness)) {
    for (let i = 0; i < edge.length; i++) {
      painter.pixel(
        edge.horizontal ? edge.x + i : edge.x,
        edge.horizontal ? edge.y : edge.y + i,
        color,
        1,
      );
    }
  }
}

function dashRect(
  painter: Painter,
  rect: MarkerBounds,
  thickness: number,
  dash: number,
  color: typeof ACCENT,
) {
  for (const edge of rectEdges(rect, thickness)) {
    for (let i = 0; i < edge.length; i++) {
      if (Math.floor(i / dash) % 2 !== 0) continue;
      painter.pixel(
        edge.horizontal ? edge.x + i : edge.x,
        edge.horizontal ? edge.y : edge.y + i,
        color,
        1,
      );
    }
  }
}

function drawBadge(painter: Painter, rect: MarkerBounds, number: number, scale: number) {
  const size = Math.max(18, Math.round(24 * scale));
  const radius = Math.floor(size / 5);
  const cx = Math.min(Math.max(rect.x, size / 2 + 2), painter.width - size / 2 - 2);
  const cy = Math.min(Math.max(rect.y, size / 2 + 2), painter.height - size / 2 - 2);
  const left = Math.round(cx - size / 2);
  const top = Math.round(cy - size / 2);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (outsideRounded(x, y, size, radius)) continue;
      painter.pixel(left + x, top + y, ACCENT, 1);
    }
  }
  const glyphs = Array.from(String(number), (digit) => DIGITS[Number(digit)] ?? DIGITS[0]!);
  const gap = Math.max(1, Math.floor(size / 16));
  const maxGlyph = Math.max(1, Math.floor((size * 0.62 - (glyphs.length - 1) * gap) / 7));
  const glyphWidth = 5 * maxGlyph;
  const total = glyphs.length * glyphWidth + (glyphs.length - 1) * gap;
  let x = Math.round(cx - total / 2);
  const y = Math.round(cy - (7 * maxGlyph) / 2);
  for (const glyph of glyphs) {
    for (let row = 0; row < 7; row++) {
      const bits = glyph[row] ?? 0;
      for (let column = 0; column < 5; column++) {
        if ((bits & (1 << (4 - column))) === 0) continue;
        for (let dy = 0; dy < maxGlyph; dy++) {
          for (let dx = 0; dx < maxGlyph; dx++) {
            painter.pixel(
              x + column * maxGlyph + dx,
              y + row * maxGlyph + dy,
              { r: 255, g: 255, b: 255 },
              1,
            );
          }
        }
      }
    }
    x += glyphWidth + gap;
  }
}

function outsideRounded(x: number, y: number, size: number, radius: number) {
  if (radius <= 0) return false;
  const cx = x < radius ? radius - x : x >= size - radius ? x - (size - radius - 1) : 0;
  const cy = y < radius ? radius - y : y >= size - radius ? y - (size - radius - 1) : 0;
  return cx > 0 && cy > 0 && cx * cx + cy * cy > radius * radius;
}
