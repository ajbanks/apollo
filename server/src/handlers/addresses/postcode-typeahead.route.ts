import { AUTHENTICATION_REQUIRED } from "../../app/middleware/auth-required";
import { Route } from "../../app/route";
import { $postcodeMap } from "../../models/db/postcode-map";

export const PostcodeTypeaheadRoute = Route({
    method: "get",
    route: `/postcodes/typeahead/:partial`,
    handler: [
        AUTHENTICATION_REQUIRED,
        async (req, res) => {
            let { partial } = req.params;

            let postcodes = await $postcodeMap
                .knex()
                .select("postcode")
                .where("postcode", "ilike", `${partial}%`)
                .orWhere("slug", "ilike", `${partial}%`)
                .limit(25);

            return res.json(postcodes.map((p) => p.postcode));
        },
    ],
});
