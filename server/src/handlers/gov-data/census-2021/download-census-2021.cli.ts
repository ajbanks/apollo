import * as cheerio from "cheerio";
import { CliCommand } from "../../../app/cli-command";
import { $proxyV2 } from "../../../services/proxy";
import { dumpFile, dumpPath } from "../../../utils/dump-file";
import { $logger } from "../../../utils/logger";
import unzipper from "unzipper";
import { createWriteStream } from "fs";

export const DownloadCensusDataCmd = CliCommand({
    name: "download-census-data",
    handler: async () => {
        let html = await $proxyV2({
            url: "https://www.nomisweb.co.uk/sources/census_2021_bulk",
        });

        let $html = cheerio.load(html.data);

        let downloadLinks: string[] = [];

        // Select all 'a' tags where href starts with '/output/'
        $html('a[href^="/output/"]').each(function (this: any) {
            let href = $html(this).attr("href");

            if (href && !href.includes("-extra")) {
                downloadLinks.push(`https://www.nomisweb.co.uk${href}`);
            }
        });

        $logger.info(`found ${downloadLinks.length} links`);

        for (let link of downloadLinks) {
            try {
                let { data: buffer } = await $proxyV2({
                    url: link,
                    responseType: "arraybuffer",
                });

                let dir = await unzipper.Open.buffer(buffer);

                let files = dir.files.filter((file) => {
                    return ["-oa.csv", "-ltla.csv"].some((end) =>
                        file.path.endsWith(end)
                    );
                });

                if (!files) {
                    $logger.warn(
                        {
                            url: link,
                            files: dir.files.map((file) => file.path),
                        },
                        "no oa21 file found"
                    );

                    continue;
                }

                await Promise.all(
                    files.map(async (file) => {
                        await dumpFile(
                            `./census-2021/${file.path}`,
                            await file.buffer()
                        );
                    })
                );

                $logger.info({ link }, `downloaded files from link`);
            } catch (err) {
                $logger.error(err);
            }
        }

        $logger.info("all files downloaded");
    },
});
