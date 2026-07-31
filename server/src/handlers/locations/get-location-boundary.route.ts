import { ExpectationFailed } from "@bahatron/utils/lib/error";
import { AUTHENTICATION_REQUIRED } from "../../app/middleware/auth-required";
import { Route } from "../../app/route";
import { $locations } from "../../models/db/locations";
import { $schema, Static } from "../../utils/json-schema";
import { $logger } from "../../utils/logger";

type AcceptedFormat = Static<typeof ACCEPTED_FORMATS>;
let ACCEPTED_FORMATS = $schema.StringEnum([
    "h3_9",
    "h3_7",
    "h3_11",
    "geometry",
] as const);

export const GetLocationBoundaryRoute = Route({
    method: "get",
    route: "/locations/boundary",
    docs: {
        tags: ["Locations"],
        security: true,
        parameters: [
            {
                in: "query",
                name: "code",
                schema: $schema.String(),
                required: true,
            },
            {
                in: "query",
                name: "type",
                schema: $schema.String(),
                required: true,
            },
            {
                in: "query",
                name: "format",
                schema: ACCEPTED_FORMATS,
            },
        ],
        responses: {
            200: {
                schema: $schema.Any(),
            },
        },
    },
    handler: [
        AUTHENTICATION_REQUIRED,
        async (req, res) => {
            let { code, type, format } = $schema.validate(
                req.query,
                $schema.Object({
                    code: $schema.String(),
                    type: $schema.String(),
                    format: $schema.Optional(ACCEPTED_FORMATS),
                })
            );

            return res.json(
                await getLocationBoundary({
                    code,
                    type,
                    format,
                })
            );
        },
    ],
});

export async function getLocationBoundary({
    code,
    type,
    format = "geometry",
}: {
    code: string;
    type: string;
    format?: AcceptedFormat;
}) {
    $logger.info({ code, type, format }, "getLocationBoundary called with");

    let query = $locations.knex().select(format).where({ code, type }).first();

    $logger.info(query.toString(), "getLocationBoundary SQL");

    let data = await query;

    if (!data) throw ExpectationFailed("Location boundary not found");

    return data[format];
}
