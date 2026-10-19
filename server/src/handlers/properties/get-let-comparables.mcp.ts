import z from "zod";
import { McpRoute } from "../../app/mcp-route";
import { PropertyTypes } from "./property-type.values";
import { getLetComparableProperties } from "./get-let-comparables";
import { jsonStringify } from "@bahatron/utils/lib/helpers";

export const GetLetComparablesMCP = McpRoute((server) => {
    server.registerTool(
        "get-let-comparable-properties",
        {
            title: "Get Let Comparable Properties",
            description:
                "Retrieve comparable rental listings (Rightmove lettings: asking and let-agreed) near a postcode or lat/lon. Use status='Let agreed' for achieved rents.",
            inputSchema: {
                bedrooms: z
                    .number()
                    .int()
                    .optional()
                    .describe("Exact bedrooms to match"),
                property_type: z
                    .enum(Object.values(PropertyTypes) as any)
                    .optional(),
                property_subtype: z.string().optional(),
                let_type: z
                    .string()
                    .optional()
                    .describe("e.g. long_term, short_term"),
                status: z
                    .string()
                    .optional()
                    .describe(
                        "display_status filter, e.g. 'Let agreed' for achieved rents"
                    ),
                months: z
                    .number()
                    .optional()
                    .describe(
                        "Window in months on first_visible_at (default 12)"
                    ),
                postcode: z.string().optional(),
                lat: z.number().optional(),
                lon: z.number().optional(),
                limit: z
                    .number()
                    .optional()
                    .describe("Max records (default 25, cap 100)"),
            },
        },
        async (input) => {
            let listings = await getLetComparableProperties({
                bedrooms: input.bedrooms ?? null,
                propertyType: input.property_type ?? null,
                propertySubType: input.property_subtype ?? null,
                letType: input.let_type ?? null,
                status: input.status ?? null,
                months: input.months ?? 12,
                floorArea: null,
                postcode: input.postcode ?? null,
                lat: input.lat ?? null,
                lon: input.lon ?? null,
                ringSize: null,
                limit: input.limit ?? 25,
            });

            return {
                content: [
                    {
                        type: "text",
                        text: jsonStringify(listings),
                    },
                ],
            };
        }
    );
});
