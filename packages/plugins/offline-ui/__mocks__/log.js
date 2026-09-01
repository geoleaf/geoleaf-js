/**
 * Mock Log for plugin-storage tests
 * Plugin sources use: import { Log } from '../../log/index.js'
 */
const Log = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
};
export { Log };
