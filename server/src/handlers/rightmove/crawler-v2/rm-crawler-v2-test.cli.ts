import { chromium } from "playwright";
import { CliCommand } from "../../../app/cli-command";
import { $logger } from "../../../utils/logger";
import { generateCrawlV2Urls } from "./generate-crawl-url";
import { $env } from "../../../utils/env";
import { dumpFile, dumpPath } from "../../../utils/dump-file";
import { jsonStringify } from "@bahatron/utils/lib/helpers";
import { mkdir, rm, writeFile } from "fs/promises";
import { parsePageModel } from "../crawl-details";
import { ur } from "@faker-js/faker";

export const CrawlerV2PocCmd = CliCommand({
    name: "rm-v2-test",
    handler: async () => {
        let path = dumpPath("./rm-v2-test");

        await rm(`${path}/`, { recursive: true, force: true });
        await mkdir(path);

        let url = generateCrawlV2Urls({ locationCode: "OUTCODE^1859" })[0];

        $logger.info([url], "url");

        let browser = await chromium.launch({
            proxy: {
                server: `socks5://${$env.PROXY_HOST}:${$env.PROXY_PORT}`,
            },
            headless: true,
            args: ["--no-sandbox", "--disable-setuid-sandbox"],
        });

        let pageCounter = 0;

        let page = await browser.newPage();

        page.on("response", async (res) => {
            let url = res.url();
            if (!url.includes("listing/search")) return;

            let json = await res.json();

            await writeFile(
                `${path}/response-${pageCounter}.json`,
                jsonStringify(json, null, 4)
            );

            $logger.info({ pageCounter, json }, `got api response: ${url}`);
        });

        let res = await page.goto(url, { waitUntil: "load", timeout: 60000 });

        let text = await res?.text()!;

        let pageModel = extractNextDataJson(text);

        await writeFile(
            `${path}/page-model-${pageCounter}.json`,
            jsonStringify(pageModel, null, 4)
        );

        let { properties, pagination } =
            pageModel?.props?.pageProps?.searchResults ?? {};

        if (!properties || !pagination) {
            $logger.warn(`no properties or pagination found`);
            return;
        }

        while (pageCounter < 4) {
            await writeFile(
                `${path}/page-${pageCounter++}.jpg`,
                await page.screenshot()
            );

            await Promise.all([
                page.waitForURL(/index=/),
                page.click('button[data-testid="nextPage"]'),
            ]);

            let content = await page.content();

            let pageModel = extractNextDataJson(content);

            await writeFile(
                `${path}/page-model-${pageCounter}.json`,
                jsonStringify(pageModel, null, 4)
            );

            $logger.info(`waited for page counter..`);
        }
    },
});

function extractNextDataJson(htmlString: string): any {
    const match = htmlString.match(
        /<script[^>]*id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s
    );
    dumpFile;
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
