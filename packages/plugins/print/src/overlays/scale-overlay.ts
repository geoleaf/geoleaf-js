/*!
 * @geoleaf-plugins/print — Scale bar overlay
 *
 * Draws a graduated scale bar on a 2D canvas context at the bottom-left of the
 * map zone. Reuses the same scale denominator locked by the print flow.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
/**
 * Scale bar overlay for the composed print canvas.
 *
 * Picks the largest "round" ground length that fits the allotted width, draws the bar and
 * its two labels, and cites the denominator the print flow locked. The denominator is
 * formatted by {@link formatScaleDenominator} — deliberately NOT `toLocaleString()`,
 * because a printed sheet must read the same as the on-screen scale control (see that
 * module for the arbitration).
 */
import { formatScaleDenominator } from "../scale-format.js";

/** Pixel rectangle of the map zone on the composed canvas. */
export interface MapZonePx {
    x: number;
    y: number;
    widthPx: number;
    heightPx: number;
}

/** Smallest ground length the scale bar will ever show — first entry of {@link GROUND_STEPS_M}. */
const SMALLEST_GROUND_STEP_M = 10;

/** Candidate ground lengths (metres) for the scale bar, in ascending order. */
const GROUND_STEPS_M = [
    SMALLEST_GROUND_STEP_M,
    20,
    50,
    100,
    200,
    500,
    1_000,
    2_000,
    5_000,
    10_000,
    20_000,
    50_000,
    100_000,
    200_000,
    500_000,
];

/** Target bar width range on paper: 20–60 mm. */
const BAR_MIN_MM = 20;
const BAR_MAX_MM = 60;

/** Draws a graduated scale bar at the bottom-left of the map zone. */
export function drawScaleOverlay(
    ctx: CanvasRenderingContext2D,
    zone: MapZonePx,
    scaleDenominator: number,
    dpi: number
): void {
    const pxPerMm = dpi / 25.4;

    // Pick the largest ground length whose paper width falls within [20–60 mm].
    // The list is a non-empty literal, but a plain array cannot say so; the default names the
    // smallest step rather than asserting the read (qualite Q5).
    let chosenGroundM: number = GROUND_STEPS_M[0] ?? SMALLEST_GROUND_STEP_M;
    for (const step of GROUND_STEPS_M) {
        const barMm = (step / scaleDenominator) * 1000;
        if (barMm >= BAR_MIN_MM && barMm <= BAR_MAX_MM) {
            chosenGroundM = step;
        } else if (barMm > BAR_MAX_MM) {
            break;
        }
    }

    const barMm = (chosenGroundM / scaleDenominator) * 1000;
    const barPx = Math.round(barMm * pxPerMm);

    // Label strings
    const scaleLabel = `1:${formatScaleDenominator(scaleDenominator)}`;
    const distLabel = chosenGroundM >= 1000 ? `${chosenGroundM / 1000} km` : `${chosenGroundM} m`;

    // Position: bottom-left of map zone with 8 mm margin
    const marginPx = Math.round(8 * pxPerMm);
    const barHeight = Math.round(3 * pxPerMm);
    const fontSize = Math.round(Math.max(9, 2.5 * pxPerMm));

    ctx.save();

    ctx.font = `${fontSize}px sans-serif`;
    const scaleTextW = ctx.measureText(scaleLabel).width;
    const xLeft = zone.x + marginPx;
    const yBottom = zone.y + zone.heightPx - marginPx;

    // Background panel for readability
    const panelW = Math.max(barPx, scaleTextW) + marginPx * 0.8;
    const panelH = fontSize * 2 + barHeight + Math.round(3 * pxPerMm);
    ctx.fillStyle = "rgba(255,255,255,0.78)";
    ctx.fillRect(
        xLeft - Math.round(4 * pxPerMm),
        yBottom - panelH - Math.round(2 * pxPerMm),
        panelW,
        panelH + Math.round(4 * pxPerMm)
    );

    // Scale denominator text (above bar)
    const yText1 = yBottom - barHeight - Math.round(4 * pxPerMm) - fontSize * 0.3;
    ctx.fillStyle = "#222";
    ctx.fillText(scaleLabel, xLeft, yText1);

    // Graduated bar
    const yBar = yBottom - barHeight - Math.round(1.5 * pxPerMm);
    ctx.fillStyle = "#222";
    ctx.fillRect(xLeft, yBar, barPx, barHeight);

    // White mid-segment for graduation
    ctx.fillStyle = "#fff";
    ctx.fillRect(xLeft + Math.floor(barPx / 4), yBar, Math.floor(barPx / 2), barHeight);

    // Distance label (below bar)
    ctx.fillStyle = "#222";
    ctx.font = `${Math.round(fontSize * 0.9)}px sans-serif`;
    ctx.fillText(distLabel, xLeft, yBottom + Math.round(1.5 * pxPerMm));

    ctx.restore();
}
