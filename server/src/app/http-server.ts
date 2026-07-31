import express, { ErrorRequestHandler, RequestHandler, Router } from "express";
import { Route } from "./route";
import { $logger } from "../utils/logger";
import { globSync } from "fs";
import { createSwaggerDocs, SwaggerConfig } from "./swagger";

export function AppServer({
    routes,
    preRouteMiddleware,
    errorHandler,
    swagger,
}: {
    preRouteMiddleware: (RequestHandler | [string, RequestHandler])[];
    routes: string | Route[];
    errorHandler: ErrorRequestHandler[];
    swagger?: SwaggerConfig;
}) {
    let app = express();

    app.use((req, res, next) => {
        res.removeHeader("x-powered-by");
        return next();
    });

    app.use(
        express.json({
            verify: (req, res, buffer) => {
                (req as any).raw = buffer;
            },
        })
    );

    preRouteMiddleware.forEach((middleware) => {
        Array.isArray(middleware)
            ? app.use(...middleware)
            : app.use(middleware);
    });

    let router = Router();

    let parsedRoutes = Array.isArray(routes) ? routes : getRoutes(routes);
    for (let route of parsedRoutes) {
        router[route.method](route.route, route.handler);

        $logger.debug(
            `registered route: ${route.method.toUpperCase()} ${route.route}`
        );
    }

    if (swagger?.enabled) {
        let basePath = swagger.path ?? "/docs";
        let specPath = `${basePath}/openapi.json`;

        let swaggerDocs = createSwaggerDocs({
            routes: parsedRoutes,
            ...swagger,
        });

        router.get(specPath, (req, res) => {
            res.json(swaggerDocs);
        });

        router.get(basePath, (req, res) => {
            res.send(
                `
                    <!doctype html>
                    <html>
                    <head>
                        <meta charset="utf-8">
                        <script type="module" src="https://unpkg.com/rapidoc/dist/rapidoc-min.js"></script>
                    </head>
                    <body>
                        <rapi-doc 
                            spec-url="${specPath}"
                            render-style="view"
                        >
                        </rapi-doc>
                    </body>
                    </html>
                `
            );
        });
    }

    app.use(router);

    app.use(errorHandler);

    return app;
}

function getRoutes(routesPath: string) {
    let fileNames = globSync(routesPath);

    let routes: Route[] = [];
    fileNames.forEach((fileName) => {
        try {
            let route = require(fileName);

            Object.entries(route).forEach(([name, route]) => {
                if (Route.isRoute(route)) {
                    routes.push(route);
                }
            });
        } catch (err: any) {
            $logger.warn(
                { fileName, err: err.message },
                `error loading route file`
            );
        }
    });

    return routes;
}
