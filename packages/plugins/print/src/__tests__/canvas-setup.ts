/**
 * Global canvas 2D context mock for happy-dom.
 * happy-dom does not implement HTMLCanvasElement.getContext('2d') — patch
 * document.createElement so every canvas element has a minimal mock context.
 *
 * Loaded via vitest.config.ts setupFiles before any test file is collected.
 */

import { vi } from "vitest";

const _origCreateElement = document.createElement.bind(document);

document.createElement = (tagName: string, options?: ElementCreationOptions): HTMLElement => {
    const el = _origCreateElement(tagName as keyof HTMLElementTagNameMap, options);
    if (tagName.toLowerCase() === "canvas") {
        const canvas = el as HTMLCanvasElement;
        const mockCtx: Partial<CanvasRenderingContext2D> & { canvas: HTMLCanvasElement } = {
            canvas,
            drawImage: vi.fn(),
            fillRect: vi.fn(),
            clearRect: vi.fn(),
            save: vi.fn(),
            restore: vi.fn(),
            scale: vi.fn(),
            translate: vi.fn(),
            fillText: vi.fn(),
            strokeText: vi.fn(),
            measureText: vi.fn(() => ({ width: 0 }) as TextMetrics),
            beginPath: vi.fn(),
            closePath: vi.fn(),
            moveTo: vi.fn(),
            lineTo: vi.fn(),
            stroke: vi.fn(),
            fill: vi.fn(),
            arc: vi.fn(),
            strokeRect: vi.fn(),
            rect: vi.fn(),
            clip: vi.fn(),
        };
        canvas.getContext = vi.fn((id: string) =>
            id === "2d" ? (mockCtx as unknown as CanvasRenderingContext2D) : null
        ) as unknown as HTMLCanvasElement["getContext"];
        canvas.toDataURL = vi.fn(() => "data:image/png;base64,fakedata");
    }
    return el;
};
