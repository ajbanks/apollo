import { TooManyRequests, Unauthorized } from "@bahatron/utils/lib/error";
import { $redis } from "../../services/redis";
import { $logger } from "../../utils/logger";
import { $session } from "../session.service";
import moment from "moment";
import { getAuthToken } from "./parse-session";
import { $apiKeys } from "../../models/db/api-keys";
import { RequestHandler } from "express";
import { $env } from "../../utils/env";
import { $slack } from "../../services/slack";
import { $clickhouse } from "../../services/clickhouse";

const MAX_REQUESTS_PER_MINUTE = 600;

/**
 * @description Checks if the API KEY is valid, enabled and has not exceeded the rate limit
 * since there's a validity check, this takes care of authentication as well
 */
export const RATE_LIMITED: RequestHandler = async (req, res, next) => {
    if ($env.DEV_MODE) {
        $logger.warn(`Dev mode, skipping rate limitting..`);
        return next();
    }

    $logger.info(
        { url: req.url, original: req.originalUrl, path: req.path },
        "checking rate limit",
    );

    let apiKey = $session.getStore()?.session;

    if (!apiKey || !apiKey.enabled) {
        $logger.warn(apiKey, "invalid api key");
        throw Unauthorized();
    }

    let key = `rate:limit:${apiKey.key}`;

    let date = moment().add(1, "minute").startOf("minute").toDate();

    let requests = await $redis.client.incr(key);

    if (requests === 1) {
        $logger.debug("setting expiry");
        await $redis.client.expire(key, 61);
    }

    res.setHeader("X-RateLimit-Limit", MAX_REQUESTS_PER_MINUTE);
    res.setHeader("X-RateLimit-Remaining", MAX_REQUESTS_PER_MINUTE - requests);
    res.setHeader("X-RateLimit-Reset", date.toISOString());

    if (requests > MAX_REQUESTS_PER_MINUTE) {
        throw TooManyRequests(
            { limit: MAX_REQUESTS_PER_MINUTE, requests: requests },
            "RATE_LIMITED_EXCEEDED",
        );
    }

    let start = new Date();
    res.once("close", async () => {
        try {
            await $clickhouse.client.insert({
                table: "api_usage_logs",
                format: "JSONEachRow",
                values: [
                    {
                        api_key: apiKey.key,
                        endpoint: req.url,
                        status_code: res.statusCode,
                        response_time_ms:
                            new Date().valueOf() - start.valueOf(),
                    },
                ],
            });
        } catch (err: any) {
            $logger.warn(err);

            await $slack.sendMessage({
                text: `Error inserting API request log: ${err.message}`,
                context: err,
            });
        }
    });

    return next();
};
