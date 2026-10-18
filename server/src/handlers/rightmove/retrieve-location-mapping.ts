import axios from "axios";
import { $logger } from "../../utils/logger";

// Pinned UA — rotating through fake-useragent strings (incl. odd/handheld
// agents) intermittently trips Rightmove's 403s; one real Chrome UA is
// what the python mappa-scrapers run that proved this endpoint used.
const USER_AGENT =
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Resolve a plain location name (outcode like "LU1", town, station…) to its
 * Rightmove locationIdentifier ("OUTCODE^1556"). Ported from the
 * mappa-scrapers python project (location_mapping_scraper.py) — fetches the
 * house-prices page and pulls the identifier out of the first href that
 * carries one.
 *
 * Returns null when no identifier is found (bad outcode, RM blocking, etc).
 */
export async function retrieveLocationMapping(
    location: string,
): Promise<string | null> {
    const url = `https://www.rightmove.co.uk/house-prices/${location.toLowerCase()}.html`;

    for (let attempt = 0; attempt < 3; attempt++) {
        const res = await axios
            .get(url, {
                headers: {
                    "User-Agent": USER_AGENT,
                    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
                    "Accept-Language": "en-GB,en;q=0.9",
                    "Upgrade-Insecure-Requests": "1",
                },
                timeout: 10000,
                validateStatus: () => true,
            })
            .catch((err: any) => ({ status: 0, data: null, _err: err } as any));

        if (res.status !== 200 || typeof res.data !== "string") {
            $logger.warn(
                { location, status: res.status, attempt },
                `location mapping fetch failed`,
            );
            await sleep(500 * (attempt + 1));
            continue;
        }

        // Find the first href carrying locationIdentifier=<TYPE>^<N>
        const match = res.data.match(
            /href="[^"]*locationIdentifier=([A-Z]+\^\d+)/,
        );

        if (match?.[1]) {
            $logger.info(
                { location, identifier: match[1] },
                `location mapping retrieved`,
            );
            return match[1];
        }

        await sleep(500 * (attempt + 1));
    }

    return null;
}

/**
 * Bulk version — sequential with a small cooldown between requests, matching
 * the python original (concurrency there is nominally 1).
 */
export async function retrieveLocationMappingBulk(
    locations: string[],
    cooldownMs = 100,
): Promise<Record<string, string | null>> {
    const mappings: Record<string, string | null> = {};

    for (const location of locations) {
        mappings[location] = await retrieveLocationMapping(location);
        await sleep(cooldownMs);
    }

    const found = Object.values(mappings).filter(Boolean).length;
    $logger.info(
        { requested: locations.length, found },
        `location mappings retrieved`,
    );

    return mappings;
}
