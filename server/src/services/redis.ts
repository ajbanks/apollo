import { createClient, SetOptions } from "redis";
import { $env } from "../utils/env";
import { $logger } from "../utils/logger";
import { jsonParse, jsonStringify } from "@bahatron/utils/lib/helpers";

const client = createClient({
    url: $env.REDIS_URL,
    socket: {
        tls: $env.REDIS_USE_TLS,
    },
});

client.connect().then(() => $logger.info(`redis connection established`));

export const $redis = {
    client,

    async set(key: string, data: any, options?: SetOptions) {
        await client.set(key, jsonStringify(data), options);
    },

    async get<T = any>(key: string) {
        let result = await client.get(key);
        return jsonParse(result) as T | undefined;
    },

    async del(keys: string | string[]) {
        await client.del(keys);
    },

    /**
     * @todo: refactor into using multi for improved performance
     */
    async remember<T = any>(
        key: string,
        handler: () => Promise<T>,
        options?: SetOptions
    ): Promise<T> {
        let result = await $redis.get(key);

        if (result) return result;

        result = await handler();

        await $redis.set(key, result, options);

        return result;
    },
};
