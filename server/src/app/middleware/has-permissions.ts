import { RequestHandler } from "express";
import { Unauthorized } from "@bahatron/utils/lib/error";
import { $env } from "../../utils/env";
import { $logger } from "../../utils/logger";
import { ApiPermissions } from "../../handlers/api-management/api-permissions.enum";
import { $session } from "../session.service";

export const HAS_PERMISSIONS: (
    permissions: ApiPermissions[]
) => RequestHandler = (permissions) => {
    return async (req, res, next) => {
        if ($env.DEV_MODE) {
            $logger.warn(`dev mode, skipping permission check`);
            return next();
        }

        let apiKey = $session.getStore()?.session;

        if (!apiKey) throw Unauthorized();

        let hasPermission =
            !permissions.length ||
            apiKey.permissions.includes(ApiPermissions.ADMIN) ||
            apiKey.permissions.some((perm: any) => permissions.includes(perm));

        if (!hasPermission) throw Unauthorized();

        next();
    };
};
