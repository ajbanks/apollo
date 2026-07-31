import { $properties, Property } from "../../models/db/properties";
import { $epcEngland, EpcCertificate } from "../../models/db/epc-england";
import {
    $landRegistryEngland,
    LandRegistryRecord,
} from "../../models/db/land-registry-england";
import {
    $propertyListings,
    PropertyListing,
} from "../../models/db/property-listings";
import { $logger } from "../../utils/logger";
import { $h3 } from "../../utils/h3";
import { EpcToPropertyTypeMap } from "./property-type.values";
import { $floodRisk } from "../../models/db/flood-risk";
import { $uprnOs, UprnOS } from "../../models/db/uprn-os";
import { ValidationFailed } from "@bahatron/utils/lib/error";
import { commercialPropertyTypeMapV1 } from "./commercial-property-type-map-v1";

export async function buildPropertyFromUprn(uprn: string): Promise<void> {
    let [uprnOs, epcCertificate, transaction, listings] = await Promise.all([
        $uprnOs.knex().where({ uprn }).first(),
        $epcEngland
            .knex()
            .where({ uprn })
            .orderBy("lodgement_date", "desc")
            .first(),
        $landRegistryEngland
            .knex()
            .where({ uprn })
            .orderBy("date", "desc")
            .first(),
        $propertyListings
            .knex()
            .select("bathrooms", "bedrooms", "property_type", "uprn", "channel")
            .where({ uprn })
            .orderBy("last_crawled_at", "desc"),
    ]);

    let property = await buildProperty({
        uprn: uprnOs!,
        epcCertificate: epcCertificate!,
        transaction,
        listings,
    });

    let query = $properties.knex().insert(property);

    await query.onConflict("uprn").merge();

    $logger.info(`property record set for uprn: ${uprn}`);
}

export async function buildProperty({
    uprn,
    epcCertificate,
    transaction,
    listings = [],
    inspireId,
}: {
    uprn: UprnOS;
    epcCertificate: EpcCertificate;
    transaction?: LandRegistryRecord;
    listings?: Partial<PropertyListing>[];
    inspireId?: string;
}) {
    let checks = {
        epc_certificate_exists: Boolean(epcCertificate),
        uprn_exists: Boolean(uprn),
        valid_property_type: epcCertificate?.property_type !== "Park Home",
    };

    $logger.debug({ checks }, `checks`);

    if (!Object.values(checks).every(Boolean)) {
        throw ValidationFailed(checks, "CANNOT_CREATE_PROPERTY");
    }

    let address = epcCertificate!.address
        .toUpperCase()
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
        .join(" ");

    let h3_7 =
        uprn?.lat && uprn?.lon
            ? $h3.latLngToCell(uprn?.lat, uprn?.lon, 7)
            : null;
    let h3_9 =
        uprn?.lat && uprn?.lon
            ? $h3.latLngToCell(uprn?.lat, uprn?.lon, 9)
            : null;
    let h3_11 =
        uprn?.lat && uprn?.lon
            ? $h3.latLngToCell(uprn?.lat, uprn?.lon, 11)
            : null;
    let h3_13 =
        uprn?.lat && uprn?.lon
            ? $h3.latLngToCell(uprn?.lat, uprn?.lon, 13)
            : null;

    let h3_15 =
        uprn?.lat && uprn?.lon
            ? $h3.latLngToCell(uprn?.lat, uprn?.lon, 15)
            : null;

    let [floodRiskResult] = await Promise.all([
        $floodRisk
            .knex()
            .select("flood_risk")
            .whereRaw("h3_11 @> ARRAY[?]::text[]", [h3_11])
            .orderBy("flood_risk", "asc")
            .first(),
    ]);

    let record: Property = {
        uprn: uprn.uprn!,
        lat: uprn?.lat ?? null,
        lon: uprn?.lon ?? null,
        postcode: epcCertificate!.postcode.toUpperCase(),
        address,
        num_habitable_rooms:
            epcCertificate!.number_habitable_rooms ??
            epcCertificate!.number_heated_rooms,
        last_transaction_date: transaction?.date ?? null,
        last_transaction_price: transaction?.price ?? null,
        total_floor_area: epcCertificate!.total_floor_area,
        last_epc_certificate_date: epcCertificate!.lodgement_date,
        bathrooms:
            listings?.find((i) => Boolean(i.bathrooms))?.bathrooms ?? null,
        bedrooms: listings?.find((i) => Boolean(i.bedrooms))?.bedrooms ?? null,
        epc: epcCertificate!.current_epc_rating,
        ownership_type: transaction?.duration.toLowerCase() ?? null,
        property_type: parsePropertyType(epcCertificate!),
        h3_7,
        h3_9,
        h3_11,
        h3_13,
        h3_15,
        flood_risk: floodRiskResult?.flood_risk ?? null,
        extensions: epcCertificate?.extension_count
            ? Number(epcCertificate?.extension_count)
            : null,
        potential_epc: epcCertificate!.potential_epc_rating ?? null,
        type: epcCertificate!.epc_type,
        new_build: !transaction ? null : transaction?.new_build,

        floor_level: epcCertificate?.floor_level,
        flat_storey_count: epcCertificate?.flat_storey_count,

        occupation_type: parseOcupationType(epcCertificate?.tenure),
        last_transaction_id: transaction?.transaction_id ?? null,
        last_epc_certificate_id: epcCertificate?.id ?? null,
        council_tax_band:
            listings.find((i) => i.council_tax_band)?.council_tax_band ?? null,
        year_built_normalised:
            constructionAgeBandWrangler(epcCertificate?.construction_age_band)
                ?.mean ?? null,

        floor_height: !epcCertificate?.floor_height
            ? null
            : Number(epcCertificate?.floor_height),
        epc_rating: epcCertificate?.current_energy_efficiency ?? null,
        epc_potential_rating:
            epcCertificate?.potential_energy_efficiency ?? null,
        inspire_id: inspireId ?? null,
    };

    return record;
}

function parseOcupationType(tenure: any) {
    if (!tenure) return null;

    let parsed = (tenure as string).toLowerCase();

    if (parsed.includes("private")) {
        return "rented";
    } else if (parsed.includes("social")) {
        return "social_housing";
    } else if (parsed.includes("owner")) {
        return "owner";
    } else {
        return null;
    }
}

function parsePropertyType(epcCertificate: EpcCertificate) {
    if (epcCertificate?.epc_type === "commercial") {
        return commercialPropertyTypeMapV1(epcCertificate.property_type);
    }

    let { property_type, built_form } = epcCertificate;

    return EpcToPropertyTypeMap[property_type][built_form];
}

function constructionAgeBandWrangler(
    band: string | null
): { min: number; max: number; mean: number } | null {
    if (!band) return null;

    function sane(y: number): number | null {
        let currentYear = new Date().getFullYear();
        if (y >= 1066 && y < currentYear) {
            return y;
        }
        return null;
    }

    let matcher =
        /England and Wales:\s*(?:(\d{4})(?:\s*-\s*(\d{4})|(?:\s+onwards|\s+before))?|\bbefore\s+(\d{4}))/;

    let m = band.match(matcher);

    if (!m) {
        let parsed = sane(parseInt(band, 10));
        return !parsed ? null : { min: parsed, max: parsed, mean: parsed };
    }

    let captures = m.slice(1); // First element is the full match, the rest are captures

    let nonNullCaptures = captures.filter((c) => c !== undefined && c !== null);

    if (nonNullCaptures.length === 1) {
        if (captures[0]) {
            let val = sane(parseInt(captures[0], 10));
            return !val
                ? null
                : {
                      min: val,
                      max: val,
                      mean: val,
                  };
        } // Single year or "before" year
        if (captures[2]) {
            let val = sane(parseInt(captures[2], 10));
            return !val
                ? null
                : {
                      min: val,
                      max: val,
                      mean: val,
                  };
        } // "before" year
    } else if (nonNullCaptures.length === 2) {
        let start = sane(parseInt(captures[0], 10));
        let end = sane(parseInt(captures[1], 10));

        return !start || !end
            ? null
            : {
                  min: start!,
                  max: end!,
                  mean: sane(Math.floor((start + end) / 2))!,
              };
    }

    return null;
}
