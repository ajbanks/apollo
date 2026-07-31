import { snakeCase } from "lodash";
import { $redis } from "../../services/redis";
import { jsonStringify, jsonParse } from "@bahatron/utils/lib/helpers";
import { $nominatim } from "../../services/nominatim";
import { $googleMaps } from "../../services/google-maps";

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

async function geocode(query: string) {
    let geocoded = await $nominatim.search({ query });

    if (geocoded.length) {
        return {
            lat: geocoded[0]?.lat,
            lon: geocoded[0]?.lon,
        };
    }

    let googleGeocode = await $googleMaps.geocode({ address: query });

    if (googleGeocode.length) {
        return {
            lat: googleGeocode[0].geometry.location.lat.toString(),
            lon: googleGeocode[0].geometry.location.lng.toString(),
        };
    }

    return null;
}
