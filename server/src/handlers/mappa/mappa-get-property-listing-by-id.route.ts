import { ExpectationFailed } from "@bahatron/utils/lib/error";
import { RATE_LIMITED } from "../../app/middleware/rate-limit";
import { Route } from "../../app/route";
import {
    $propertyListings,
    PropertyListingSchema,
} from "../../models/db/property-listings";
import { HAS_PERMISSIONS } from "../../app/middleware/has-permissions";
import { ApiPermissions } from "../api-management/api-permissions.enum";

export const GetPropertyListingByIdRoute = Route({
    method: "get",
    route: "/mappa/property-listings/:id",
    docs: {
        security: true,
        description: "Get a property listing by its ID.",
        tags: ["Mappa"],
        badges: [{ label: ApiPermissions.PROPERTY_LISTINGS_VIEW }],
        parameters: [
            {
                in: "path",
                name: "id",
                required: true,
                schema: {
                    type: "string",
                },
                description: "The ID of the property listing to retrieve.",
            },
        ],
        responses: {
            200: {
                schema: PropertyListingSchema,
            },
        },
    },
    handler: [
        HAS_PERMISSIONS([ApiPermissions.PROPERTY_LISTINGS_VIEW]),
        RATE_LIMITED,
        async (req, res) => {
            let { id }: any = req.params;

            let listing = await $propertyListings.knex().where({ id }).first();

            if (!listing) {
                throw ExpectationFailed({ id }, "Property listing not found");
            }

            return res.json(listing);
        },
    ],
});
