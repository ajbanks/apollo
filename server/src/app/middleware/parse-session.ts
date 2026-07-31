import { Request, RequestHandler } from "express";
import { $logger } from "../../utils/logger";
import { $jwt } from "../../utils/jwt";
import { $session } from "../session.service";
import { $apiKeys } from "../../models/db/api-keys";

export function getAuthToken(req: Request) {
    let token = req.headers.authorization;

    if (!token) return null;

    return token.replaceAll(`Bearer `, ``);
}

/**
 * not suitable for external api key check
 */
export const PARSE_REQUEST_SESSION: RequestHandler = async (req, res, next) => {
    try {
        $logger.debug(`parsing request session...`);

        let token = getAuthToken(req);

        if (!token) {
            $logger.warn(`no auth token found`);
            return next();
        }

        let result: any = await $apiKeys.knex().where({ key: token }).first();

        if (!result) {
            result = $jwt.verify(token!) as any;
        }

        $logger.debug({ token, result }, `request session parsed`);

        return $session.run(
            {
                ...$session.getStore(),
                session: result,
            },
            next
        );
    } catch (err: any) {
        $logger.warn(err.message);
        return next();
    }
};
