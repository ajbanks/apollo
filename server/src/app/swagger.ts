import { JsonSchema } from "@bahatron/utils/lib/json-schema";
import { sortBy } from "lodash";
import { Route } from "./route";
import { NotImplemented } from "@bahatron/utils/lib/error";

export interface SwaggerConfig {
    enabled?: boolean;
    path?: string;
    engine: "redoc" | "swagger-ui" | "rapidoc";
    info: {
        title: string;
        description?: string;
        version?: string;
    };
    securityType?: "api_key" | "bearer" | "oauth2";
}

export function createSwaggerDocs({
    routes,
    info,
    securityType,
}: SwaggerConfig & {
    routes: Route[];
}) {
    let parsedSecuritySchemes = !securityType
        ? undefined
        : securityType === "api_key"
        ? {
              api_key: {
                  type: "apiKey",
                  in: "header",
                  name: "Authorization",
              },
          }
        : securityType === "bearer"
        ? {
              bearer: {
                  type: "http",
                  scheme: "bearer",
                  bearerFormat: "JWT",
              },
          }
        : securityType === "oauth2"
        ? (() => {
              throw NotImplemented("oauth2 not implemented yet");
          })()
        : undefined;

    function toSwaggerPaths(routes: Route[]) {
        return sortBy(routes, "route").reduce((carry, route) => {
            if (!route.docs?.disabled) {
                let path = route.route
                    .split("/")
                    .map((bit) =>
                        bit.startsWith(":") ? `{${bit.slice(1)}}` : bit
                    )
                    .join("/");

                if (!carry[path]) {
                    carry[path] = {} as any;
                }

                carry[path][route.method] = parseSwaggerRoute(route.docs ?? {});
            }

            return carry;
        }, {} as Record<string, Record<Route["method"], any>>);
    }

    function parseSwaggerRoute(docs: Route["docs"]) {
        return {
            ...docs,
            ["x-badges"]: docs?.badges ?? [],
            requestBody: docs?.requestBody && {
                required: docs.requestBody.required,
                content: {
                    "application/json": {
                        schema: docs.requestBody.schema,
                    },
                },
            },
            security:
                securityType &&
                (docs?.security || typeof docs?.security !== "boolean")
                    ? [
                          {
                              [securityType]: [],
                          },
                      ]
                    : undefined,
            responses:
                docs?.responses &&
                Object.entries(docs?.responses).reduce(
                    (carry, [status, doc]) => {
                        carry[status as any] = {
                            description: doc.description,
                            content: {
                                "application/json": {
                                    schema: doc.schema,
                                },
                            },
                        };
                        return carry;
                    },
                    {} as Record<number, any>
                ),
        };
    }

    return {
        openapi: "3.0.0",
        info,
        servers: [
            {
                url: "/",
            },
        ],
        paths: toSwaggerPaths(routes),

        components: {
            securitySchemes: parsedSecuritySchemes,
            schemas: routes.reduce((partial, route) => {
                return {
                    ...partial,
                    ...route.docs?.schemas,
                };
            }, {} as Record<string, JsonSchema>),
        },
    };
}
