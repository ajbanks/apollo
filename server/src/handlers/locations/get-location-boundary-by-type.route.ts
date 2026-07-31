import { simplify } from "@turf/turf";
import { AUTHENTICATION_REQUIRED } from "../../app/middleware/auth-required";
import { Route } from "../../app/route";
import { $locations } from "../../models/db/locations";
import { $logger } from "../../utils/logger";
import compression from "compression";
import { Transform, pipeline, Readable } from "node:stream";
import { jsonStringify } from "@bahatron/utils/lib/helpers";
import { ExpectationFailed } from "@bahatron/utils/lib/error";
import { $schema } from "../../utils/json-schema";

export let GetLocationBoundaryByTypeRoute = Route({
    method: "get",
    route: "/locations/boundaries-by-type",
    docs: {
        tags: ["Locations"],
        security: true,
        parameters: [
            {
                in: "query",
                name: "type",
                schema: $schema.StringEnum([
                    "lsoa21",
                    "msoa21",
                    "wd23",
                    "lad23",
                    "rgn23",
                ]),
                required: true,
                description: "The type of location boundary to retrieve",
            },
            {
                in: "query",
                name: "tolerance",
                schema: { type: "number", default: 0.001 },
                description:
                    "The simplification tolerance to apply to the boundaries",
            },
        ],
    },
    handler: [
        AUTHENTICATION_REQUIRED,
        compression({ level: 9 }),
        async (req, res) => {
            let { type, tolerance = 0.001 } = req.query as any;

            if (!type) {
                throw ExpectationFailed({ type }, "INVALID_REQUEST");
            }

            // Arrow IPC stream; compression middleware manages Content-Encoding
            res.setHeader("Content-Type", "application/json; charset=utf-8");

            // Avoid Content-Length for streaming; flush headers early if available
            res.flushHeaders();

            let readable = await pipeLocationBoundaries({
                type,
                tolerance: Number(tolerance),
            });

            // If client disconnects, stop upstream stream
            req.on("close", () => readable.destroy());

            // Pipe through response; compression() wraps res.write/res.end so gzip/brotli stays intact
            pipeline(readable, res, (err) => {
                if (err) {
                    $logger.error({ msg: "boundary stream error", err });
                    res.destroy(err as any);
                }
            });
        },
    ],
});

export async function pipeLocationBoundaries({
    type,
    tolerance,
}: {
    type: string;
    tolerance?: number;
}): Promise<Readable> {
    let rowStream = await $locations
        .knex()
        .select("code", "type", "display_name", "geometry")
        .where({ type })
        .stream();

    // Single transform: convert rows into JSON and wrap in a JSON array stream
    let toJsonArray = new Transform({
        writableObjectMode: true,
        readableObjectMode: false,
        construct(this, next) {
            this.push("[");
            next();
        },
        transform(this: any, item: any, _enc, next) {
            try {
                $logger.debug(`piping location boundary: ${item.display_name}`);

                let feature = {
                    ...simplify(item.geometry, {
                        tolerance,
                        highQuality: true,
                    }),
                    properties: {
                        code: item.code,
                        type: item.type,
                        display_name: item.display_name,
                    },
                };

                let chunk = jsonStringify(feature);

                this.push(",");
                this.push(chunk);

                next();
            } catch (err: any) {
                next(err);
            }
        },
        flush(this: any, next) {
            this.push("]");
            next();
        },
    });

    return rowStream.pipe(toJsonArray);
}
