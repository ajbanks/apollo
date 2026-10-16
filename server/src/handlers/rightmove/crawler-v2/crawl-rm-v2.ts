import axios from "axios";
import { $rmCodes } from "../../../models/db/rm-code-map";
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

const FIREFOX_UA =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:131.0) Gecko/20100101 Firefox/131.0";

const HTTP_HEADERS = {
    "User-Agent": FIREFOX_UA,
    Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-GB,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    Connection: "keep-alive",
    "Upgrade-Insecure-Requests": "1",
};

const COOKIE_JAR: Record<string, string> = {};

function buildCookieHeader(): string {
    return Object.entries(COOKIE_JAR)
        .map(([k, v]) => `${k}=${v}`)
        .join("; ");
}

function parseSetCookies(setCookie: string | string[] | undefined) {
    if (!setCookie) return;
    const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
    for (const c of cookies) {
        const match = c.match(/^([^=]+)=([^;]*)/);
        if (match) {
            COOKIE_JAR[match[1].trim()] = match[2].trim();
        }
    }
}

function randomDelay(min: number, max: number): Promise<void> {
    return new Promise((resolve) =>
        setTimeout(resolve, Math.random() * (max - min) + min),
    );
}

export async function crawlRmV2() {
    RmCrawlRunListings.clear();

    let codes = (await $rmCodes.knex().select("code")) ?? [];

    /** Visit homepage first to establish session cookies */
    try {
        $logger.info(`visiting rightmove homepage to establish session...`);
        let homeRes = await axios.get("https://www.rightmove.co.uk/", {
            headers: HTTP_HEADERS,
            timeout: 30000,
            validateStatus: () => true,
        });
        parseSetCookies(homeRes.headers["set-cookie"]);
        $logger.info(
            { status: homeRes.status, cookies: Object.keys(COOKIE_JAR) },
            `homepage visit complete`,
        );
    } catch (err: any) {
        $logger.warn({ error: err?.message }, `homepage visit failed`);
    }

    for (let { code } of codes) {
        let urls = generateCrawlV2Urls({ locationCode: code });

        try {
            await retry(() => {
                return rightmoveSpiderV2({ urls, locationCode: code });
            });
        } catch (err: any) {
            $slack.sendMessage({
                text: `RM v2 CRAWLER - SPIDER ERROR`,
                context: {
                    error: err?.message,
                    locationCode: code,
                },
            });
        }

        await randomDelay(5000, 10000);
    }

    await $rmApiCrawlResults.add({
        timestamp: new Date().toISOString(),
        result: jsonStringify(Array.from(RmCrawlRunListings)),
    });
}

let _buildId: string | null = null;

/**
 * Fetch a search page's `searchResults` payload as cheaply as possible.
 *
 * Rightmove is a Next.js app — `/_next/data/<buildId>/<route>.json` returns
 * the exact same `pageProps.searchResults` object that v2 used to scrape out
 * of the `__NEXT_DATA__` script tag, at a fraction of the bytes (the old
 * `/api/_search` endpoint is dead — 403 through the proxy too). Each cycle's
 * first request is still HTML, which both yields results and harvests the
 * current buildId; if the buildId rotates mid-cycle the data route misses and
 * we silently fall back to HTML once.
 */
export async function fetchSearchResults(url: URL): Promise<{
    searchResults: any;
    status: number;
    via: "json" | "html";
}> {
    if (_buildId) {
        let dataUrl = new URL(
            `/_next/data/${_buildId}${url.pathname}.json`,
            url.origin,
        );
        url.searchParams.forEach((v, k) => dataUrl.searchParams.set(k, v));

        let res = await axios.get(dataUrl.toString(), {
            headers: {
                ...HTTP_HEADERS,
                Accept: "application/json",
                Referer: url.toString(),
                Cookie: buildCookieHeader(),
            },
            timeout: 30000,
            validateStatus: () => true,
        });

        parseSetCookies(res.headers["set-cookie"]);

        let sr = res.data?.pageProps?.searchResults;
        if (res.status === 200 && sr && !res.data?.pageProps?.__N_REDIRECT) {
            return { searchResults: sr, status: res.status, via: "json" };
        }

        // buildId likely rotated — drop it and fall through to HTML
        _buildId = null;
    }

    let response = await axios.get(url.toString(), {
        headers: {
            ...HTTP_HEADERS,
            Referer: "https://www.rightmove.co.uk/",
            Cookie: buildCookieHeader(),
        },
        timeout: 30000,
        validateStatus: () => true,
    });

    parseSetCookies(response.headers["set-cookie"]);

    let pageModel = extractSearchPageModel(response.data);
    if (pageModel?.buildId) {
        _buildId = pageModel.buildId;
    }

    return {
        searchResults: pageModel?.props?.pageProps?.searchResults,
        status: response.status,
        via: "html",
    };
}

async function rightmoveSpiderV2({
    urls,
    locationCode,
}: {
    urls: string[];
    locationCode: string;
}) {
    for (let baseUrl of urls) {
        $logger.debug({ url: baseUrl }, `crawling page`);

        await randomDelay(2000, 5000);

        let url: URL | null = new URL(baseUrl);

        while (url) {
            let start = moment();

            await randomDelay(1500, 3500);

            let { searchResults, status, via } = await fetchSearchResults(url);

            RmCrawlerBus.emit(RmCrawlerBusEvents.SEARCH_CALL);
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
                    via,
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
