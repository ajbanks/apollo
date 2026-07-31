import z from "zod";
import { McpRoute } from "../../app/mcp-route";
import { $h3 } from "../../utils/h3";
import { $locations } from "../../models/db/locations";
import { $locationStatisticsV3 } from "../../models/db/location-statistics";
import { PropertyTypes } from "../properties/property-type.values";
import { $logger } from "../../utils/logger";
import { jsonStringify } from "@bahatron/utils/lib/helpers";
import { omit, pick } from "lodash";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

const LOCATION_ORDER: Record<string, number> = {
    h3_7: 0,
    wd23: 1,
    lad23: 2,
};

const inputSchema = {
    lat: z.string().describe("Latitude of the point"),
    lon: z.string().describe("Longitude of the point"),
    bedrooms: z
        .number()
        .int()
        .optional()
        .describe("Filter by number of bedrooms"),
    property_type: z
        .enum(Object.values(PropertyTypes) as any)
        .optional()
        .describe("Filter by property type"),
};

export const GetStatisticsForPointMcp = McpRoute((server) => {
    server.registerTool(
        "get-location-property-statistics",
        {
            title: "Get property statistics based on a point",
            description: "Get property statistics based on a point",
            inputSchema,
        },
        getLocationStatisticsMcpHandler
    );
});

const schema = z.object(inputSchema);
export const getLocationStatisticsMcpHandler = async ({
    lat,
    lon,
    bedrooms,
    property_type,
}: z.infer<typeof schema>): Promise<CallToolResult> => {
    let h3_9 = $h3.latLngToCell(Number(lat), Number(lon), 9);

    let h3_7 = $h3.latLngToCell(Number(lat), Number(lon), 7);

    let locations = await $locations
        .knex()
        .select("code", "type", "display_name")
        .whereIn("type", ["wd23", "lad23"])
        .whereRaw(`h3_9 @> Array[?]`, [h3_9]);

    let statistics = await $locationStatisticsV3
        .knex()
        .whereIn("location_code", [h3_7, ...locations.map((l) => l.code)])
        .whereIn("location_type", ["h3_7", "wd23", "lad23"])
        .whereIn("bedrooms", [bedrooms, "any"].filter(Boolean) as any)
        .whereIn(
            "property_type",
            [property_type, "any"].filter(Boolean) as any
        );

    const getRank = (s: any) => {
        const loc = LOCATION_ORDER[s.location_type] ?? Number.MAX_SAFE_INTEGER;
        const prop = s.property_type === property_type ? 0 : 1; // prefer exact property_type over 'any'
        const beds = s.bedrooms === bedrooms ? 0 : 1; // prefer exact bedrooms over 'any'
        return [loc, prop, beds] as const; // location > property_type > bedrooms
    };

    const closestMatch = statistics
        .map((val) => ({
            location_type: val.location_type,
            location_code: val.location_code,
            bedrooms: val.bedrooms,
            property_type: val.property_type,
            ...pick(val.data, [
                "buy_paid_price_median",
                "buy_paid_price_median_yoy",
                "buy_paid_price_per_sqm",
                "buy_asking_price_median",
                "buy_asking_price_median_yoy",
                "buy_asking_price_per_sqm",
                "let_asking_price_median",
                "let_asking_price_median_yoy",
                "let_asking_price_per_sqm",
                "let_asking_yield",
                "let_paid_yield_yoy",
            ]),
            buy_asking_days_on_market: val.data.buy_asking_entry_to_agreed_days,
            buy_asking_days_on_market_yoy:
                val.data.buy_asking_entry_to_agreed_days_yoy,

            let_asking_days_on_market: val.data.let_asking_entry_to_agreed_days,
            let_asking_days_on_market_yoy:
                val.data.let_asking_entry_to_agreed_days_yoy,
        }))
        .reduce((best: any, s: any) => {
            if (!best) return s;
            const a = getRank(s);
            const b = getRank(best);
            if (a[0] !== b[0]) return a[0] < b[0] ? s : best;
            if (a[1] !== b[1]) return a[1] < b[1] ? s : best;
            if (a[2] !== b[2]) return a[2] < b[2] ? s : best;
            return best;
        }, undefined as any);

    $logger.debug(
        {
            entries: statistics.map((val) => ({
                location_type: val.location_type,
                location_code: val.location_code,
                bedrooms: val.bedrooms,
                property_type: val.property_type,
            })),
            closestMatch: pick(closestMatch, [
                "location_type",
                "location_code",
                "bedrooms",
                "property_type",
            ]),
        },
        "closestMatch"
    );

    return {
        content: [
            {
                type: "text",
                text: jsonStringify(
                    omit(closestMatch, ["location_type", "location_code"])
                ),
            },
        ],
    };
};
