import z from "zod";
import { McpRoute } from "../../app/mcp-route";
import { PropertyTypes } from "./property-type.values";
import { getComparableProperties } from "./get-comparables";
import { jsonStringify } from "@bahatron/utils/lib/helpers";

export const GetComparablesMCP = McpRoute((server) => {
    server.registerTool(
        "get-comparable-properties",
        {
            title: "Get Comparable Properties",
            description:
                "Retrieve a list of comparable properties based on specified criteria",
            inputSchema: {
                bedrooms: z.number().int().describe("Number of bedrooms"),
                property_type: z.enum(Object.values(PropertyTypes) as any),
                new_build: z
                    .boolean()
                    .optional()
                    .describe("Is it a new build?"),
                floor_area: z
                    .number()
                    .optional()
                    .describe("Floor area in square meters"),
                postcode: z
                    .string()
                    .optional()
                    .describe("Postcode of the property"),
                lat: z.number().optional().describe("Latitude of the property"),
                lon: z
                    .number()
                    .optional()
                    .describe("Longitude of the property"),
            },
        },
        async (input) => {
            let comparables = await getComparableProperties({
                bedrooms: input.bedrooms,
                propertyType: input.property_type,
                newBuild: input.new_build ?? null,
                floorArea: input.floor_area ?? null,
                postcode: input.postcode ?? null,
                lat: input.lat ?? null,
                lon: input.lon ?? null,
            });

            return {
                content: [
                    {
                        type: "text",
                        text: jsonStringify(comparables),
                    },
                ],
            };
        }
    );
});
