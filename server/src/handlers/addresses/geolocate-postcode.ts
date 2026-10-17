import { $postcodeMap, PostcodeMap } from "../../models/db/postcode-map";
import { $logger } from "../../utils/logger";
import { normalisePostcode } from "./postcode.utils";
import {
    $findThatPostcode,
    PostcodeResponse,
} from "../../services/find-that-postcode";
import moment from "moment";
import { $postcodeMeta } from "../../models/db/postcode-meta";
import { $h3 } from "../../utils/h3";

export async function geolocatePostcode(
    postcode: string,
    forceUpdate = false
): Promise<PostcodeMap | undefined> {
    postcode = postcode.toUpperCase();
    try {
        let record = await $postcodeMap
            .knex()
            .where({ postcode: postcode })
            .orWhere({ slug: normalisePostcode(postcode) })
            .first();

        $logger.debug({ postcode, record: !!record }, `found postcode`);

        if (record && !forceUpdate) return record;

        // Outcode input (e.g. "LU1", "SW1A"): find-that-postcode only
        // resolves full postcodes, so fall back to postcodes.io's outcode
        // endpoint which returns the outcode centroid.
        if (/^[A-Z]{1,2}\d[A-Z]?$/.test(postcode)) {
            let res = await fetch(
                `https://api.postcodes.io/outcodes/${encodeURIComponent(postcode)}`,
            );
            if (!res.ok) return undefined;
            let body: any = await res.json();
            let r = body?.result;
            if (!r?.latitude || !r?.longitude) return undefined;
            let payload: PostcodeMap = {
                postcode,
                slug: normalisePostcode(postcode),
                lat: r.latitude,
                lon: r.longitude,
                h3_9: $h3.latLngToCell(r.latitude, r.longitude, 9),
                country_name: r.country?.[0] ?? null,
                region: r.region?.[0] ?? null,
                region_name: r.region?.[0] ?? null,
                district: r.admin_district?.[0] ?? null,
                district_name: r.admin_district?.[0] ?? null,
                ward: r.admin_ward?.[0] ?? null,
                ward_name: r.admin_ward?.[0] ?? null,
            } as PostcodeMap;
            await $postcodeMap
                .knex()
                .insert(payload)
                .onConflict("postcode")
                .merge();
            return payload;
        }

        let meta = await getOrFetchPostcodeMeta(postcode);

        let lat = meta.data.attributes.location?.lat;
        let lon = meta.data.attributes.location?.lon;
        let h3Index = lat && lon ? $h3.latLngToCell(lat, lon, 9) : null;

        let payload: PostcodeMap = {
            postcode: meta.data.attributes.pcds,
            slug: normalisePostcode(postcode),
            lat,
            lon,
            h3_9: h3Index,
            country: meta.data.attributes.ctry,
            country_name: meta.data.attributes.ctry_name,
            region: meta.data.attributes.rgn,
            region_name: meta.data.attributes.rgn_name,
            county: meta.data.attributes.cty,
            county_name: meta.data.attributes.cty_name,
            district: meta.data.attributes.laua,
            district_name: meta.data.attributes.laua_name,
            msoa21: meta.data.attributes.msoa21,
            msoa21_name: meta.data.attributes.msoa21_name,
            ttwa: meta.data.attributes.ttwa,
            ttwa_name: meta.data.attributes.ttwa_name,
            ward: meta.data.attributes.ward,
            ward_name: meta.data.attributes.ward_name,
            urban_type_code: meta.data.attributes.ru11ind?.code,
            urban_type_description: meta.data.attributes.ru11ind?.description,
            area_type_code: meta.data.attributes.oac11?.code,
            area_type_group: meta.data.attributes.oac11?.group,
            area_type_subgroup: meta.data.attributes.oac11?.subgroup,
            area_type_supergroup: meta.data.attributes.oac11?.supergroup,
        };

        await $postcodeMap
            .knex()
            .insert(payload)
            .onConflict("postcode")
            .merge();

        $logger.info({ postcode }, `postcode geolocated`);

        return payload;
    } catch (err: any) {
        if (err.isAxiosError) return;

        $logger.error({ err, postcode }, "error geolocating postcode");

        throw err;
    }
}

async function getOrFetchPostcodeMeta(
    postcode: string
): Promise<PostcodeResponse> {
    let meta = await $postcodeMeta.knex().where({ postcode }).first();

    let isOlderThan90days =
        moment().diff(moment(meta?.updated_at), "days") > 90;

    if (meta && !isOlderThan90days) {
        return meta.metadata;
    }

    let response = await $findThatPostcode.postcode(postcode);

    await $postcodeMeta
        .knex()
        .insert({
            postcode,
            metadata: response,
            updated_at: new Date(),
        })
        .onConflict("postcode")
        .merge();

    return response;
}
