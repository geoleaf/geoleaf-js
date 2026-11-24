/**
 * A fake server of the `"pair"` contract, as a `fetch` double — what the session suites run
 * the real store and the real client against.
 *
 * It ROTATES: each renewal consumes the refresh token presented and issues the next one. A
 * refresh token presented a second time is counted in `replays` and refused with a `401` — the
 * behaviour of a server that treats a replay as a theft. A suite asserting `replays === 0`
 * therefore asserts what the device-wide lock exists for.
 *
 * Every answer waits `delayMs` (default 10 ms), so that two renewals asked at once genuinely
 * overlap. `requests` keeps every call: url and parsed body.
 */

export interface PairServerOptions {
    readonly loginUrl: string;
    readonly refreshUrl: string;
    readonly revokeUrl: string;
    readonly delayMs?: number;
    readonly expiresIn?: number;
    readonly refreshExpiresIn?: number;
}

/** What a test arranges for the next answers of a route. */
export interface PairServerOverrides {
    /** Answer the next calls of this route with this status, empty body, headers given. */
    status?: number;
    headers?: Record<string, string>;
    body?: unknown;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function answer(status: number, body: unknown, headers: Record<string, string> = {}) {
    const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: (name: string) => lower[name.toLowerCase()] ?? null },
        text: () => Promise.resolve(typeof body === "string" ? body : JSON.stringify(body)),
    };
}

export function makePairServer(options: PairServerOptions) {
    const live = new Set<string>();
    const spent = new Set<string>();
    const revoked: string[] = [];
    const requests: { url: string; body: Record<string, unknown> }[] = [];
    const overrides = new Map<string, PairServerOverrides>();
    let issued = 0;
    let replays = 0;

    const issue = () => {
        issued += 1;
        const refreshToken = `rt-${issued}`;
        live.add(refreshToken);
        return {
            access_token: `at-${issued}`,
            refresh_token: refreshToken,
            expires_in: options.expiresIn ?? 3600,
            ...(options.refreshExpiresIn !== undefined && {
                refresh_expires_in: options.refreshExpiresIn,
            }),
        };
    };

    const fetchDouble = async (url: string, init: { body?: string } = {}) => {
        const body = init.body ? (JSON.parse(init.body) as Record<string, unknown>) : {};
        requests.push({ url, body });
        await wait(options.delayMs ?? 10);
        const forced = overrides.get(url);
        if (forced) return answer(forced.status ?? 200, forced.body ?? "", forced.headers);
        if (url === options.loginUrl) return answer(200, issue());
        if (url === options.refreshUrl) {
            const presented = String(body["refresh_token"]);
            if (spent.has(presented)) {
                replays += 1;
                return answer(401, "");
            }
            if (!live.has(presented)) return answer(401, "");
            live.delete(presented);
            spent.add(presented);
            return answer(200, issue());
        }
        if (url === options.revokeUrl) {
            revoked.push(String(body["token"]));
            live.delete(String(body["token"]));
            return answer(200, "");
        }
        return answer(404, "");
    };

    return {
        fetch: fetchDouble,
        /** Issues a pair outside any request — the session a device holds at boot. */
        seed: () => issue(),
        requests,
        revoked,
        overrides,
        get replays(): number {
            return replays;
        },
        /** How many renewals reached the server. */
        get renewals(): number {
            return requests.filter((r) => r.url === options.refreshUrl).length;
        },
    };
}
