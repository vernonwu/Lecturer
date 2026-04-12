"use client";

import { useEffect, useRef } from "react";

interface PdfPageCanvasProps {
  imageDataUrl: string;
  width: number;
  height: number;
}

export function PdfPageCanvas({ imageDataUrl, width, height }: PdfPageCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) {
      return;
    }

    let cancelled = false;
    const image = new window.Image();
    image.onload = () => {
      if (cancelled) {
        return;
      }
      context.clearRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);
    };
    image.src = imageDataUrl;

    return () => {
      cancelled = true;
    };
  }, [height, imageDataUrl, width]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className="h-auto w-full bg-white transition-[filter] duration-300 dark:hue-rotate-180 dark:invert"
    />
  );
}
