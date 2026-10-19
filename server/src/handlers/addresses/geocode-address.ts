import { snakeCase } from "lodash";
import { $redis } from "../../services/redis";
import { jsonStringify, jsonParse } from "@bahatron/utils/lib/helpers";
import { $nominatim } from "../../services/nominatim";
import { $googleMaps } from "../../services/google-maps";
import { $env } from "../../utils/env";
import { $logger } from "../../utils/logger";

export async function geocodeAddress(
    query: string,
): Promise<{ lat: string; lon: string } | null> {
    let cacheKey = `geocode:${snakeCase(query.toLowerCase())}`;

    let cache = jsonParse(await $redis.get(cacheKey));

    if (!cache) {
        cache = (await geocode(query)) ?? {};

        // cache for 30 days
        await $redis.set(cacheKey, jsonStringify(cache), {
            EX: 3600 * 24 * 30,
        });
    }

    return Object.keys(cache).length ? cache : null;
}

const UK_POSTCODE =
    /\b([A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2})\b/i;

async function geocode(query: string) {
    let geocoded = await $nominatim.search({ query });

    if (!geocoded.length) {
        // Full addresses often miss in OSM — retry with just the postcode
        let postcode = query.match(UK_POSTCODE)?.[1];
        if (postcode) {
            geocoded = await $nominatim.search({ query: postcode });
        }
    }

    if (geocoded.length) {
        return {
            lat: geocoded[0]?.lat,
            lon: geocoded[0]?.lon,
        };
    }

    // Google fallback only when a key is configured — a missing key throws a
    // REQUEST_DENIED that surfaces as a 417 to callers, which is worse than
    // an honest null.
    if ($env.GOOGLE_MAPS_API_KEY) {
        let googleGeocode = await $googleMaps
            .geocode({ address: query })
            .catch((err) => {
                $logger.warn(
                    { query, err: err?.message },
                    "google maps geocode failed — returning null",
                );
                return [] as any[];
            });

        if (googleGeocode.length) {
            return {
                lat: googleGeocode[0].geometry.location.lat.toString(),
                lon: googleGeocode[0].geometry.location.lng.toString(),
            };
        }
    }

    return null;
}
