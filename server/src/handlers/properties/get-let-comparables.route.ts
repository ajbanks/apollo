import { AUTHENTICATION_REQUIRED } from "../../app/middleware/auth-required";
import { Route } from "../../app/route";
import { $schema } from "../../utils/json-schema";
import {
    getLetComparableProperties,
    LetComparablePropertiesResponseSchema,
} from "./get-let-comparables";
import { PropertyTypes } from "./property-type.values";

export const GetLetComparablesRoute = Route({
    method: "get",
    route: "/properties/let-comparables",
    docs: {
        tags: ["Properties"],
        description:
            "Retrieve comparable lettings (Rightmove rental listings) near a postcode or lat/lon. Covers RES_LET and STU_LET channels; display_status distinguishes asking vs let-agreed records.",
        parameters: [
            {
                in: "query",
                name: "bedrooms",
                schema: $schema.Number(),
                description: "Exact bedrooms to match (optional)",
            },
            {
                in: "query",
                name: "property_type",
                schema: $schema.Enum(PropertyTypes),
            },
            {
                in: "query",
                name: "property_subtype",
                schema: $schema.String(),
            },
            {
                in: "query",
                name: "let_type",
                schema: $schema.String(),
                description: "e.g. long_term, short_term",
            },
            {
                in: "query",
                name: "status",
                schema: $schema.String(),
                description:
                    "display_status filter, e.g. 'Let agreed' for achieved rents; omit for asking + let-agreed",
            },
            {
                in: "query",
                name: "months",
                schema: $schema.Number(),
                description:
                    "Window in months on first_visible_at (default 12)",
            },
            {
                in: "query",
                name: "postcode",
                schema: $schema.String(),
            },
            { in: "query", name: "lat", schema: $schema.Number() },
            { in: "query", name: "lon", schema: $schema.Number() },
            {
                in: "query",
                name: "ring_size",
                schema: $schema.Number(),
                description:
                    "Override the h3 ring size (default progressively expands 5,10,20)",
            },
            {
                in: "query",
                name: "limit",
                schema: $schema.Number(),
                description: "Max records (default 25, cap 100)",
            },
        ],
        responses: {
            200: {
                schema: $schema.Array(LetComparablePropertiesResponseSchema),
            },
        },
    },
    handler: [
        AUTHENTICATION_REQUIRED,
        async (req, res) => {
            let {
                bedrooms,
                property_type: propertyType,
                property_subtype: propertySubType,
                let_type: letType,
                status,
                months,
                floor_area: floorArea,
                postcode,
                lat,
                lon,
                ring_size: ringSize,
                limit,
            } = req.query as any;

            let listings = await getLetComparableProperties({
                bedrooms: bedrooms == null ? null : Number(bedrooms),
                propertyType: propertyType || null,
                propertySubType: propertySubType || null,
                letType: letType || null,
                status: status || null,
                months: months == null ? 12 : Number(months),
                floorArea: floorArea == null ? null : Number(floorArea),
                postcode: postcode || null,
                lat: lat == null ? null : Number(lat),
                lon: lon == null ? null : Number(lon),
                ringSize: ringSize == null ? null : Number(ringSize),
                limit: limit == null ? 25 : Number(limit),
            });

            res.status(200).json(listings);
        },
    ],
});
