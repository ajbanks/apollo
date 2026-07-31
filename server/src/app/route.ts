import { JsonSchema } from "@bahatron/utils/lib/json-schema";
import { Request, Response, RequestHandler } from "express";

export interface Route {
    method: "post" | "get" | "put" | "patch" | "delete";
    route: string;
    handler: RequestHandler | RequestHandler[];
    docs?: {
        badges?: { color?: string; label: string }[];
        disabled?: boolean;
        tags?: string[];
        description?: string;

        /**
         * @todo change this to either an enum or a boolean
         * an enum will need to check that the value provided is set in the server's swagger config
         * a boolean will need to assume the security scheme is unique per server
         */
        security?: boolean;
        deprecated?: boolean;
        parameters?: {
            in: "path" | "query" | "header";
            name: string;
            required?: true;
            schema?: JsonSchema;
            description?: string;
        }[];
        requestBody?: {
            required?: boolean;
            schema: JsonSchema;
        };
        responses?: {
            [k: number]: {
                description?: string;
                schema: JsonSchema;
            };
        };
        schemas?: {
            [k: string]: JsonSchema;
        };
    };
}

const _proto = {};

export const asyncRoute = (
    handler: (req: Request, res: Response) => void
): RequestHandler => {
    return async (req, res, next) => {
        try {
            await handler(req, res);
        } catch (err) {
            next(err);
        }
    };
};

export function Route(route: Route): Route {
    return Object.setPrototypeOf(route, _proto);
}

Route.isRoute = (obj): obj is Route => {
    return Object.getPrototypeOf(obj) === _proto;
};

Route.asyncRoute = asyncRoute;
