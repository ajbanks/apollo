import { AUTHENTICATION_REQUIRED } from "../../app/middleware/auth-required";
import { Route } from "../../app/route";
import { getTitleMetaByUprn } from "./get-title-meta-by-uprn";

export const GetDeedAvailabilityByUprnRoute = Route({
    method: "get",
    route: "/hmlr/title-meta/:uprn",
    handler: [
        AUTHENTICATION_REQUIRED,
        async (req, res) => {
            let { uprn } = req.params;
            let { test } = req.query;

            // todo

            res.json({});
        },
    ],
});
