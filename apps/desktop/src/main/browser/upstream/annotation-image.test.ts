// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";
import {
  annotationCaptureScale,
  detectChannelOrder,
  drawAnnotationMarker,
  type ChannelOrder,
  type MarkerBounds,
} from "./annotation-image.ts";

const ACCENT = { r: 74, g: 130, b: 255 };

function bitmap(width: number, height: number, fill = 0) {
  return Buffer.alloc(width * height * 4, fill);
}

function writePixel(
  buffer: Buffer,
  width: number,
  x: number,
  y: number,
  color: { r: number; g: number; b: number },
  order: ChannelOrder,
) {
  const index = (y * width + x) * 4;
  if (order === "bgra") {
    buffer[index] = color.b;
    buffer[index + 1] = color.g;
    buffer[index + 2] = color.r;
  } else {
    buffer[index] = color.r;
    buffer[index + 1] = color.g;
    buffer[index + 2] = color.b;
  }
  buffer[index + 3] = 255;
}

function readPixel(
  buffer: Buffer,
  width: number,
  x: number,
  y: number,
  order: ChannelOrder,
): { r: number; g: number; b: number } {
  const index = (y * width + x) * 4;
  return order === "bgra"
    ? { r: buffer[index + 2] ?? 0, g: buffer[index + 1] ?? 0, b: buffer[index] ?? 0 }
    : { r: buffer[index] ?? 0, g: buffer[index + 1] ?? 0, b: buffer[index + 2] ?? 0 };
}

function marker(mode: "element" | "area", bounds: MarkerBounds, number = 1) {
  return { mode, bounds, number, scale: 1 };
}

describe("annotation marker painting", () => {
  it("captures at device resolution and only scales down past the pixel budget", () => {
    expect(annotationCaptureScale(1_000, 700, 1)).toEqual({ clipScale: 1, imageScale: 1 });
    expect(annotationCaptureScale(900, 700, 2)).toEqual({ clipScale: 1, imageScale: 2 });
    expect(annotationCaptureScale(1_000, 700, 0.5)).toEqual({ clipScale: 1, imageScale: 0.5 });
    const huge = annotationCaptureScale(4_000, 3_000, 2);
    expect(huge.clipScale).toBeLessThan(1);
    expect(huge.imageScale).toBeLessThan(2);
    expect(4_000 * 3_000 * huge.imageScale ** 2).toBeCloseTo(16_000_000, 0);
    expect(annotationCaptureScale(0, 0, 2).clipScale).toBe(1);
  });
  it("detects the channel order from a red reference pixel", () => {
    const bgra = bitmap(1, 1);
    writePixel(bgra, 1, 0, 0, { r: 255, g: 0, b: 0 }, "bgra");
    expect(detectChannelOrder(bgra)).toBe("bgra");
    const rgba = bitmap(1, 1);
    writePixel(rgba, 1, 0, 0, { r: 255, g: 0, b: 0 }, "rgba");
    expect(detectChannelOrder(rgba)).toBe("rgba");
    expect(() => detectChannelOrder(bitmap(1, 1))).toThrow();
  });

  for (const order of ["bgra", "rgba"] as const) {
    it(`strokes an outline, fill, and numbered badge (${order})`, () => {
      const width = 100;
      const height = 80;
      const buffer = bitmap(width, height);
      drawAnnotationMarker(
        buffer,
        width,
        height,
        marker("element", { x: 10, y: 10, width: 50, height: 30 }),
        order,
      );
      const outline = readPixel(buffer, width, 11, 11, order);
      expect(outline.r).toBe(ACCENT.r);
      expect(outline.g).toBe(ACCENT.g);
      expect(outline.b).toBe(ACCENT.b);
      const filled = readPixel(buffer, width, 35, 25, order);
      expect(filled.r).toBeGreaterThan(0);
      expect(filled.r).toBeLessThan(ACCENT.r);
      expect(filled.b).toBeGreaterThan(filled.r);
      expect(readPixel(buffer, width, 70, 25, order)).toEqual({ r: 0, g: 0, b: 0 });
      const badge = Array.from({ length: 25 }, (_, y) =>
        Array.from({ length: 25 }, (_, x) => readPixel(buffer, width, x, y, order)),
      ).flat();
      expect(badge.some((pixel) => pixel.r === 255 && pixel.g === 255 && pixel.b === 255)).toBe(
        true,
      );
    });
  }

  it("dashes area outlines but not element outlines", () => {
    const width = 140;
    const height = 100;
    const solid = bitmap(width, height);
    drawAnnotationMarker(
      solid,
      width,
      height,
      marker("element", { x: 10, y: 10, width: 100, height: 50 }),
      "bgra",
    );
    const dashed = bitmap(width, height);
    drawAnnotationMarker(
      dashed,
      width,
      height,
      marker("area", { x: 10, y: 10, width: 100, height: 50 }, 2),
      "bgra",
    );
    expect(readPixel(solid, width, 34, 10, "bgra").b).toBe(ACCENT.b);
    expect(readPixel(solid, width, 40, 10, "bgra").b).toBe(ACCENT.b);
    expect(readPixel(dashed, width, 34, 10, "bgra").b).toBe(ACCENT.b);
    expect(readPixel(dashed, width, 40, 10, "bgra").b).not.toBe(ACCENT.b);
  });

  it("clamps geometry that extends past the bitmap and ignores unusable bounds", () => {
    const width = 40;
    const height = 40;
    const buffer = bitmap(width, height);
    drawAnnotationMarker(
      buffer,
      width,
      height,
      marker("element", { x: -10, y: -10, width: 30, height: 30 }),
      "bgra",
    );
    expect(readPixel(buffer, width, 4, 4, "bgra").b).toBe(ACCENT.b);
    const untouched = bitmap(width, height);
    drawAnnotationMarker(
      untouched,
      width,
      height,
      marker("area", { x: Number.NaN, y: 10, width: 10, height: 10 }),
      "bgra",
    );
    expect(untouched.equals(bitmap(width, height))).toBe(true);
    expect(() =>
      drawAnnotationMarker(
        bitmap(2, 2),
        10,
        10,
        marker("element", { x: 0, y: 0, width: 1, height: 1 }),
        "bgra",
      ),
    ).toThrow();
  });
});
