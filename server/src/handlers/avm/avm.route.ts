import { AUTHENTICATION_REQUIRED } from "../../app/middleware/auth-required";
import { Route } from "../../app/route";
import { $schema } from "../../utils/json-schema";
import { PropertyTypes } from "../properties/property-type.values";
import { callAvm } from "./run-avm-v1";

export const AvmRoute = Route({
    method: "get",
    route: "/avm",
    docs: {
        tags: ["AVM"],
        description:
            "Automated Valuation Model. Returns estimated sale and rental values for a property based on EPC, Land Registry, and Rightmove data using XGBoost models.",
        security: true,
        parameters: [
            {
                in: "query",
                name: "postcode",
                schema: $schema.String(),
                required: true,
                description: "Full postcode, e.g. SW1A 1AA",
            },
            {
                in: "query",
                name: "bedrooms",
                schema: $schema.Integer(),
                required: true,
            },
            {
                in: "query",
                name: "bathrooms",
                schema: $schema.Integer(),
                required: true,
            },
            {
                in: "query",
                name: "property_type",
                schema: $schema.Enum(PropertyTypes),
                required: true,
            },
            {
                in: "query",
                name: "lat",
                schema: $schema.Number(),
                description: "Latitude (optional if postcode provided)",
            },
            {
                in: "query",
                name: "lon",
                schema: $schema.Number(),
                description: "Longitude (optional if postcode provided)",
            },
            {
                in: "query",
                name: "total_floor_area",
                schema: $schema.Number(),
                description: "Floor area in sqm (from EPC)",
            },
            {
                in: "query",
                name: "last_sale_price",
                schema: $schema.Number(),
                description: "Last sale price in GBP (from Land Registry)",
            },
            {
                in: "query",
                name: "last_sale_date",
                schema: $schema.String(),
                description: "Last sale date YYYY-MM-DD (from Land Registry)",
            },
        ],
        responses: {
            200: {
                description: "Valuation estimate with sales and rental values",
                schema: $schema.Object({
                    estimate: $schema.Object({
                        sales: $schema.Object({
                            estimate: $schema.Number(),
                            low: $schema.Number(),
                            high: $schema.Number(),
                            central_error: $schema.Number(),
                        }),
                        rent: $schema.Object({
                            estimate: $schema.Number(),
                            low: $schema.Number(),
                            high: $schema.Number(),
                            central_error: $schema.Number(),
                        }),
                    }),
                    details: $schema.Object({}),
                }),
            },
        },
    },
    handler: [
        AUTHENTICATION_REQUIRED,
        async (req, res) => {
            let {
                postcode,
                bedrooms,
                bathrooms,
                property_type: propertyType,
                lat,
                lon,
                total_floor_area: totalFloorArea,
                last_sale_price: lastSalePrice,
                last_sale_date: lastSaleDate,
            } = req.query as any;

            if (!postcode) {
                return res.status(400).json({
                    error: "postcode is required",
                });
            }

            let result = await callAvm({
                postcode: String(postcode),
                bedrooms: Number(bedrooms),
                bathrooms: Number(bathrooms),
                prop_type: propertyType,
                lat: lat ? Number(lat) : undefined,
                lon: lon ? Number(lon) : undefined,
                total_floor_area: totalFloorArea
                    ? Number(totalFloorArea)
                    : undefined,
                last_sale_price: lastSalePrice
                    ? Number(lastSalePrice)
                    : undefined,
                last_sale_date: lastSaleDate
                    ? String(lastSaleDate)
                    : undefined,
            } as any);

            return res.json(result);
        },
    ],
});
