import { Route } from "../../app/route";
import { $axios } from "../../utils/axios";
import { $env } from "../../utils/env";

export const HoADocsRoute = Route({
    method: "get",
    route: `/hoa/docs`,
    docs: {
        tags: ["HOA"],
        disabled: true,
    },
    handler: [
        async (req, res) => {
            return res.send(
                `
                    <!doctype html>
                    <html>
                    <head>
                        <meta charset="utf-8">
                        <script type="module" src="https://unpkg.com/rapidoc/dist/rapidoc-min.js"></script>
                    </head>
                    <body>
                        <rapi-doc 
                            spec-url="/hoa/docs/spec.json"
                            render-style="view"
                            allow-spec-url-load="false"
                            allow-spec-file-load="false"
                            match-paths="/hoa"
                        >
                        </rapi-doc>
                    </body>
                    </html>
                `
            );
        },
    ],
});

export const HoADocsFileRoute = Route({
    method: "get",
    route: `/hoa/docs/spec.json`,
    docs: {
        tags: ["HOA"],
        disabled: true,
    },
    handler: [
        async (req, res) => {
            let { data: docs } = await $axios({
                url: `http://localhost:${$env.PORT}/docs/openapi.json`,
            });

            return res.json({
                ...docs,
                info: {
                    title: "HoA API Documentation",
                    description: "API documentation for HoA integration",
                },
                paths: Object.fromEntries(
                    Object.entries(docs.paths).filter(([path]) => {
                        return path.startsWith("/hoa");
                    })
                ),
            });
        },
    ],
});
