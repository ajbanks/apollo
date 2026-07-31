import { ExpectationFailed } from "@bahatron/utils/lib/error";
import { $epcEngland } from "../../models/db/epc-england";
import { $landRegistryEngland } from "../../models/db/land-registry-england";
import { $properties } from "../../models/db/properties";
import { $schema, Static } from "../../utils/json-schema";
import moment from "moment";
import { $logger } from "../../utils/logger";
import { $julia } from "../../services/julia";
import { PropertyTypes } from "../properties/property-type.values";

export const RunAvmFromUprnRequestSchema = $schema.Object({
    uprn: $schema.String(),
    bedrooms: $schema.Integer({ minimum: 0 }),
    bathrooms: $schema.Integer({ minium: 0 }),
    property_type: $schema.Enum(PropertyTypes),
});

export async function runAvmFromUprn({
    uprn,
    bedrooms,
    bathrooms,
    property_type,
}: {
    uprn: string;
    bedrooms: number;
    bathrooms: number;
    property_type: (typeof PropertyTypes)[keyof typeof PropertyTypes];
}) {
    let [landRegistryRecord, epcCertificate, address] = await Promise.all([
        $landRegistryEngland
            .knex()
            .where({ uprn })
            .orderBy("date", "desc")
            .first(),
        $epcEngland
            .knex()
            .where({ uprn })
            .orderBy("lodgement_date", "desc")
            .first(),
        $properties.knex().where({ uprn }).first(),
    ]);

    if (!address || !address.lat || !address.lon) {
        throw ExpectationFailed("MISSING_ADDRESS");
    }

    if (!landRegistryRecord) {
        throw ExpectationFailed("MISSING_LAND_REGISTRY_RECORD");
    }

    if (!epcCertificate || epcCertificate?.property_type === "Park Home") {
        throw ExpectationFailed("MISSING_EPC_RECORD");
    }

    return await callAvm({
        lat: address.lat,
        lon: address.lon,
        last_sale_date: landRegistryRecord.date,
        last_sale_price: landRegistryRecord.price,
        total_floor_area: epcCertificate.total_floor_area,
        prop_type: property_type,
        postcode: address.postcode,
        bedrooms,
        bathrooms,
    });
}

export type CallAvmParams = Static<typeof RequestSchema>;
const RequestSchema = $schema.Object({
    lat: $schema.Union([$schema.Number(), $schema.String()]),
    lon: $schema.Union([$schema.Number(), $schema.String()]),
    bedrooms: $schema.Union([$schema.Number(), $schema.String()]),
    bathrooms: $schema.Union([$schema.Number(), $schema.String()]),
    prop_type: $schema.Optional($schema.Enum(PropertyTypes)),
    postcode: $schema.String(),
    last_sale_price: $schema.Union([$schema.Number(), $schema.String()]),
    last_sale_date: $schema.DateExtended(),
    total_floor_area: $schema.Optional($schema.Number()),
    date: $schema.Optional($schema.DateExtended()),
});

const AvmResultV2 = $schema.Object({
    central_error: $schema.Number(),
    high: $schema.Number(),
    low: $schema.Number(),
    estimate: $schema.Number(),
});

export type AvmResultV1 = Static<typeof AvmResultV1>;
export const AvmResultV1 = $schema.Object({
    details: RequestSchema,
    estimate: $schema.Object({
        rent: AvmResultV2,
        sales: AvmResultV2,
    }),
});

export async function callAvm(payload: CallAvmParams): Promise<AvmResultV1> {
    let params = {
        ...payload,
        last_sale_date: moment(payload.last_sale_date).format("YYYY-MM-DD"),
        date: moment(payload.date ?? undefined).format("YYYY-MM-DD"),
    };

    $logger.debug(params, `calling avm service`);

    let { data } = await $julia({
        method: "get",
        url: "/avm",
        params,
    });

    return data;
}
