import compression from "compression";
import { Route } from "../../app/route";
import { $locationStatisticsV3 } from "../../models/db/location-statistics";
import { AUTHENTICATION_REQUIRED } from "../../app/middleware/auth-required";

export const GetStatisticsV3Route = Route({
    method: "get",
    route: `/statistics/v3`,
    docs: {
        security: true,
    },
    handler: [
        AUTHENTICATION_REQUIRED,
        compression({ level: 9 }),
        async (req, res) => {
            let { type, code, property_type, bedrooms, resolution }: any =
                req.query;

            res.status(200).json(
                await getStatisticsV3Handler({
                    location_type: type,
                    location_code: code,
                    property_type,
                    bedrooms,
                    resolution,
                })
            );
        },
    ],
});

export async function getStatisticsV3Handler({
    location_type = undefined,
    location_code = undefined,
    property_type = "any",
    bedrooms = "any",
    resolution = "current",
}) {
    let query = Object.entries({
        location_type,
        location_code,
        property_type,
        resolution,
        bedrooms,
    }).reduce((fold, [key, value]) => {
        if (value) fold[key] = value;
        return fold;
    }, {});

    let result = await $locationStatisticsV3.knex().where(query);

    return result.reduce((fold, item) => {
        fold[item.location_code] = item.data;
        return fold;
    }, {});
}
