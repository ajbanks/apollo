import { $logger } from "./logger";
import { createReadStream, createWriteStream } from "fs";
import { parse } from "csv";
import { Options } from "csv-parse";
import { stringify, parse as parseSync } from "csv/sync";

export const $csv = {
    stringToJson: <T = any>(string: string): T[] => {
        return parseSync(string, { columns: true, skip_empty_lines: true });
    },

    jsonToCsv: (data: any) => {
        try {
            let csv = stringify(data, { header: true });

            return csv;
        } catch (err) {
            $logger.error(err);

            return undefined;
        }
    },

    readCsv: async <T = any>(path: string) => {
        return new Promise<T[]>((resolve) => {
            let rows: any[] = [];

            createReadStream(path)
                .pipe(parse({ columns: true }))
                .on("data", (row) => {
                    rows.push(row);
                })
                .on("end", () => {
                    resolve(rows);
                });
        });
    },

    readCsvStream: (
        path: string,
        options: Options = {
            columns: true,
        }
    ) => {
        return createReadStream(path).pipe(parse(options));
    },

    /**
     * @description Assumes all items are of the same time. Path most be absolute
     * @todo make csv-stringify work!!!
     */
    writeCsvStream: async <T extends Object>(path: string, data: T[]) => {
        return new Promise<void>((resolve) => {
            let writableStream = createWriteStream(path);

            writableStream.on("open", () => {
                writableStream.write(`${Object.keys(data[0]).join(",")}\n`);

                data.forEach((item) => {
                    writableStream.write(stringify([item]));
                });

                writableStream.end();
            });

            writableStream.on("finish", resolve);
        });
    },
};
