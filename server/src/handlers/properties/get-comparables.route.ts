import { AUTHENTICATION_REQUIRED } from "../../app/middleware/auth-required";
import { Route } from "../../app/route";
import { $schema } from "../../utils/json-schema";
import {
    ComparablePropertiesResponseSchema,
    getComparableProperties,
} from "./get-comparables";
import { PropertyTypes } from "./property-type.values";

export const GetComparablesV2Route = Route({
    method: "get",
    route: "/properties/comparables",
    docs: {
        tags: ["Properties"],
        parameters: [
            {
                in: "query",
                name: "bedrooms",
                schema: $schema.Number(),
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
                name: "new_build",
                schema: $schema.Boolean(),
            },
            {
                in: "query",
                name: "floor_area",
                schema: $schema.Number(),
            },
            {
                in: "query",
                name: "postcode",
                schema: $schema.String(),
            },
            {
                in: "query",
                name: "lat",
                schema: $schema.Number(),
            },
            {
                in: "query",
                name: "lon",
                schema: $schema.Number(),
            },
        ],
        responses: {
            200: {
                schema: $schema.Array(ComparablePropertiesResponseSchema),
            },
        },
    },
    handler: [
        AUTHENTICATION_REQUIRED,
        async (req, res) => {
            let {
                bedrooms,
                property_type: propertyType,
                new_build: newBuild,
                floor_area: floorArea,
                postcode,
                lat,
                lon,
            } = req.query as any;

            return res.json(
                await getComparableProperties({
                    bedrooms: Number(bedrooms),
                    propertyType,
                    newBuild,
                    floorArea,
                    postcode,
                    lat,
                    lon,
                })
            );
        },
    ],
});
