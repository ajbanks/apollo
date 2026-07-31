import { Unauthorized } from "@bahatron/utils/lib/error";
import { $session } from "../session.service";
import { $logger } from "../../utils/logger";
import { $env } from "../../utils/env";

/**
 * @deprecated use HAS_PERMISSIONS middleware instead
 */
export const AUTHENTICATION_REQUIRED = async (req, res, next) => {
    if (!$session.getStore()?.session && !$env.DEV_MODE) {
        $logger.warn(`session not set`);

        throw Unauthorized();
    }

    return next();
};
