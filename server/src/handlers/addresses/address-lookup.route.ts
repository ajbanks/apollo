import moment from "moment";
import { Route } from "../../app/route";
import { $idealPostcodes, Suggestion } from "../../services/ideal-postcodes";
import { $redis } from "../../services/redis";
import { pick, snakeCase } from "lodash";
import { AUTHENTICATION_REQUIRED } from "../../app/middleware/auth-required";
import { naturalCompare } from "../../utils/natural-compare";

export const PropertyLookupRoute = Route({
    method: "get",
    route: "/address-lookup/:slug",
    docs: {
        security: true,
    },
    handler: [
        AUTHENTICATION_REQUIRED,
        async (req, res) => {
            let { slug }: any = req.params;

            slug = slug.toLowerCase();

            let key = `address_lookup:${snakeCase(slug)}`;

            let list = await $redis.get<Suggestion[]>(key);

            if (!list) {
                list = await $idealPostcodes.autoComplete(slug);
            }

            await $redis.set(key, list, {
                EX: 3600 * 24 * 7,
            });

            res.json(list.sort((a, b) => naturalCompare(a, b)));
        },
    ],
});
