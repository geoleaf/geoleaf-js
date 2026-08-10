// @ts-check
// Software-GL launch options for GPU-less hosts (CI ubuntu-latest, WSL).
// MapLibre needs a WebGL context; headless Chrome >=137 gates the SwiftShader
// software-GL fallback behind a flag, so on a GPU-less host the native map never
// loads without it. Applied by default; set E2E_HW_GL=1 to use the host's real
// GL (a dev machine capturing accurate perf-baseline numbers).

const SOFTWARE_GL_ARGS = [
    "--enable-unsafe-swiftshader",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--ignore-gpu-blocklist",
];

/** True when the host should use its real (hardware) GL instead of forced software. */
const useHardwareGl = process.env.E2E_HW_GL === "1";

/** Spread into a Playwright `use` block. Empty on hardware-GL hosts. */
const launchOptions = useHardwareGl ? {} : { args: SOFTWARE_GL_ARGS };

export { SOFTWARE_GL_ARGS, useHardwareGl, launchOptions };
