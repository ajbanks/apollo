import { AUTHENTICATION_REQUIRED } from "../../app/middleware/auth-required";
import { Route } from "../../app/route";
import { $schema } from "../../utils/json-schema";
import { geocodeAddress } from "./geocode-address";

export const GeocodeAddressRoute = Route({
    method: "get",
    route: "/addresses/geocode",
    docs: {
        tags: ["Addresses"],
        security: true,
        parameters: [
            {
                in: "query",
                name: "query",
                schema: { type: "string" },
                description: "The address query to geocode",
                required: true,
            },
        ],
        responses: {
            200: {
                schema: $schema.Nullable(
                    $schema.Object({
                        lat: $schema.String(),
                        lon: $schema.String(),
                    })
                ),
            },
        },
    },
    handler: [
        AUTHENTICATION_REQUIRED,
        async (req, res) => {
            let { query } = req.query as { query: string };

            let location = await geocodeAddress(query);

            res.json(location);
        },
    ],
});
