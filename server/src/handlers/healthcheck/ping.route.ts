import { $pg } from "../../services/postgres";
import { $schema } from "../../utils/json-schema";
import { Route } from "../../app/route";
import { $logger } from "../../utils/logger";
import { $session } from "../../app/session.service";

export const PingRoute = Route({
    method: "get",
    route: "/ping",
    docs: {
        tags: ["APM"],
        description: "ping",
        responses: {
            200: {
                schema: $schema.StringEnum([`pong`]),
            },
        },
    },
    handler: [
        async (req, res) => {
            $logger.debug($session.getStore(), "session");

            await $pg.raw(`select 1`);

            res.json("pong");

            return;
        },
    ],
});
