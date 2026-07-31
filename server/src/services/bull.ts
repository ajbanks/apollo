import { JobsOptions, Queue, Worker } from "bullmq";
import { $env } from "../utils/env";
import { $logger } from "../utils/logger";
import { $slack } from "./slack";
import { Processor } from "bullmq/dist/esm/types/processor";

export type AppQueue = ReturnType<typeof $bull.Queue>;

const _proto = {};
export const $bull = {
    Queue<T extends object>(name: string, handler?: Processor<T>) {
        let queue = new Queue<T>(name, {
            connection: {
                url: $env.REDIS_URL,
            },
            defaultJobOptions: {
                removeOnComplete: true,
                attempts: 3,
            },
        });

        let worker = new Worker<T>(name, handler, {
            connection: {
                url: $env.REDIS_URL,
            },
            autorun: false,
        });

        let context = {
            WORKER: worker,
            QUEUE: queue,
            add: async (val: T, options: JobsOptions = {}) => {
                await queue.add(name as any, val as any, options);
            },
            start: async () => {
                /**
                 * @description if you await this, it'll never finish
                 * We're letting it run on the background so we don't stop the main thread.
                 * If it fails, the process will crash
                 */
                worker.run();

                $logger.info(`queue worker started: ${name}`);
            },
        };

        queue.on("error", (error) => {
            $logger.error({ error }, "queue error");
            // $slack.sendMessage({
            //     channel: $slack.ERROR_NOTIFICATIONS,
            //     text: `Queue encountered an error: ${error.message}\nQueue Name:${name}\nError Name: ${error.name}`,
            // });
        });

        $logger.debug(
            {
                tls_enabled: $env.REDIS_USE_TLS,
                queue_name: name,
            },
            `queue connection instantiated`
        );

        return Object.setPrototypeOf(context, _proto) as typeof context;
    },

    isValidQueue(val: any): val is ReturnType<typeof this.Queue> {
        return Object.getPrototypeOf(val) === _proto;
    },
};
