import { BrowserContext, chromium } from "playwright";
import { $rmCodes } from "../../../models/db/rm-code-map";
import { $env } from "../../../utils/env";
import { jsonStringify, parallelize, retry } from "@bahatron/utils/lib/helpers";
import {
    RmCrawlerBus,
    RmCrawlerBusEvents,
    RmCrawlRunListings,
} from "../crawler-bus.util";
import { generateCrawlV2Urls } from "./generate-crawl-url";
import { $rmApiCrawlResults } from "../../../models/db/rm-api-crawl-results";
import { $slack } from "../../../services/slack";
import { $logger } from "../../../utils/logger";
import { processApiResult } from "../crawl-api";
import moment from "moment";
import { Decimal } from "../../../utils/number-helpers";
import { cpus } from "os";
import { $proxyV2 } from "../../../services/proxy";

export async function crawlRmV2() {
    RmCrawlRunListings.clear();

    let codes = (await $rmCodes.knex().select("code")) ?? [];

    // let browser = await chromium.launch({
    //     proxy: {
    //         server: `socks5://${$env.PROXY_HOST}:${$env.PROXY_PORT}`,
    //     },
    //     headless: true,
    //     args: ["--no-sandbox", "--disable-setuid-sandbox"],
    // });

    await parallelize({
        // queue: [{ code: "OUTCODE^1859" }],
        queue: codes,
        // workers: $env.DEV_MODE ? 1 : cpus().length,
        workers: $env.RM_API_WORKERS,
        handler: async ({ code }) => {
            let urls = generateCrawlV2Urls({ locationCode: code });

            // let context = await browser.newContext({
            //     userAgent:
            //         "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            //     viewport: { width: 1920, height: 1080 },
            //     locale: "en-GB",
            //     timezoneId: "Europe/London",
            // });

            try {
                await retry(() => {
                    return rightmoveSpiderV2({
                        // context,
                        urls,
                        locationCode: code,
                    });
                });
            } catch (err: any) {
                $slack.sendMessage({
                    text: `RM v2 CRAWLER - SPIDER ERROR`,
                    context: {
                        error: err?.message,
                        locationCode: code,
                    },
                });
            } finally {
                // await context.close();
            }
        },
    });

    await $rmApiCrawlResults.add({
        timestamp: new Date().toISOString(),
        result: jsonStringify(Array.from(RmCrawlRunListings)),
    });

    // await browser.close();
}

async function rightmoveSpiderV2({
    // context,
    urls,
    locationCode,
}: {
    urls: string[];
    locationCode: string;
    // context: BrowserContext;
}) {
    for (let baseUrl of urls) {
        $logger.debug({ url: baseUrl }, `crawling page`);

        // let page = await context.newPage();

        let url: URL | null = new URL(baseUrl);

        while (url) {
            let start = moment();

            // let response = await page.goto(url.toString(), {
            //     waitUntil: "load",
            //     timeout: 60000,
            // });

            let { data, status } = await $proxyV2({
                url: url.toString(),
            });

            /** @todo refactor events */
            RmCrawlerBus.emit(RmCrawlerBusEvents.SEARCH_CALL);

            // let pageModel = extractSearchPageModel(await response?.text()!);

            let pageModel = extractSearchPageModel(data);

            let searchResults = pageModel?.props?.pageProps?.searchResults;
            if (!searchResults) {
                if (status !== 200) {
                    await $slack.sendMessage({
                        text: `RM V2 CRAWLER - NO SEARCH RESULTS FROM PAGE`,
                        context: {
                            status,
                            locationCode,
                            url: url.toString(),
                        },
                    });
                }

                $logger.warn(
                    `no search results found, stopping crawl for location code ${locationCode}`,
                );
                return;
            }

            let pagination = searchResults?.pagination;
            let properties = searchResults?.properties;

            $logger.info(
                {
                    time: `${Decimal(moment().diff(start, "seconds", true))}s`,
                    url: url.toString(),
                    query: Object.fromEntries(url.searchParams.entries()),
                    pagination,
                    properties: properties?.length,
                },
                `navigated to page`,
            );

            for (let property of properties || []) {
                await processApiResult({ property, locationCode });
            }

            if (!pagination?.next) {
                url = null;
            } else {
                url.searchParams.set("index", pagination.next.toString());
            }
        }

        // await page.close();
    }
}

export function extractSearchPageModel(htmlString: string): any {
    const match = htmlString.match(
        /<script[^>]*id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s,
    );

    if (!match || !match[1]) {
        return null;
    }

    try {
        return JSON.parse(match[1].trim());
    } catch (err) {
        console.log(`failedLISTING_PROCESSED to parsed JSON`);
        return null;
    }
}
