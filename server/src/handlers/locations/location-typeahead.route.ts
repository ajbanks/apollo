import { $locations } from "../../models/db/locations";
import { $logger } from "../../utils/logger";
import { asyncRoute } from "../../app/route";
import { Route } from "../../app/route";
import { AUTHENTICATION_REQUIRED } from "../../app/middleware/auth-required";
import { $schema } from "../../utils/json-schema";
import { ExpectationFailed } from "@bahatron/utils/lib/error";

const IGNORED_LOCATION_TYPES = ["lad21", "oa21", "lsoa21"] as const;

export const LocationTypeaheadRoute = Route({
    method: "get",
    route: "/locations/typeahead",
    docs: {
        security: true,
        tags: ["Locations"],
        parameters: [
            {
                in: "query",
                name: "query",
                schema: { type: "string" },
                required: true,
            },
        ],
        responses: {
            200: {
                schema: $schema.Array(
                    $schema.Object({
                        code: $schema.String(),
                        type: $schema.String(),
                        display_name: $schema.String(),
                    })
                ),
            },
        },
    },
    handler: [
        AUTHENTICATION_REQUIRED,
        asyncRoute(async (req, res) => {
            let { query } = req.query as Record<string, string>;

            if (!query || query.trim().length === 0) {
                throw ExpectationFailed("query parameter is required");
            }

            res.status(200).json(await locationsTypeahead(query));
        }),
    ],
});

export async function locationsTypeahead(query: string) {
    let locations = await $locations
        .knex()
        .select(`code`, `type`, `display_name`)
        .where(`display_name`, `ilike`, `%${query.toLowerCase()}%`)
        .whereNotIn("type", IGNORED_LOCATION_TYPES)
        .orderBy("type", "desc");

    $logger.debug({
        query: query.toString(),
        result: locations.length,
    });

    return locations;
}
