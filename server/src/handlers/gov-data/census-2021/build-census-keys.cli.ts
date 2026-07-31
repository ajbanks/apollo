import { globSync } from "fs";
import { CliCommand } from "../../../app/cli-command";
import { dumpFile, dumpPath } from "../../../utils/dump-file";
import { $logger } from "../../../utils/logger";
import { $csv } from "../../../utils/csv";
import { jsonStringify } from "@bahatron/utils/lib/helpers";
import { IGNORE_CENSUS_FILES } from "./ignored-census-files.value";

const district_map_2021_to_2023 = {
    E07000026: "E06000063",
    E07000027: "E06000064",
    E07000028: "E06000063",
    E07000029: "E06000063",
    E07000030: "E06000064",
    E07000031: "E06000064",
    E07000163: "E06000065",
    E07000164: "E06000065",
    E07000165: "E06000065",
    E07000166: "E06000065",
    E07000167: "E06000065",
    E07000168: "E06000065",
    E07000169: "E06000065",
    E07000187: "E06000066",
    E07000188: "E06000066",
    E07000189: "E06000066",
    E07000246: "E06000066",
};

export const BuildCensus2021KeysCmd = CliCommand({
    name: "build-census-2021-keys",
    handler: async () => {
        let map = await buildCensus2021Keys();
        await dumpFile("census-2021-keys.json", jsonStringify(map, null, 4));
    },
});

export async function buildCensus2021Keys() {
    let files = globSync(dumpPath("**/*.csv"));

    let fileCodes: Record<string, string[]> = {};

    for (let file of files) {
        let code = file.split("-").find((path) => path.includes("ts"))!;

        if (IGNORE_CENSUS_FILES.includes(code)) continue;

        if (!fileCodes[code]) {
            fileCodes[code] = [];
        }

        fileCodes[code].push(file);
    }

    $logger.debug(fileCodes, "file codes");

    let columnMap: Record<string, { fileCode: string; key: string }> = {};
    let codeMap: Record<string, string> = {};

    for (let [fileCode, files] of Object.entries(fileCodes)) {
        let file = files[0];

        let data = await $csv.readCsv(file);

        if (!data[0]) {
            $logger.warn({ file, point: data[0] }, "file with no rows?");
            continue;
        }

        let rows = Object.keys(data[0]).filter((key) => {
            return !["date", "geography", "geography code"].includes(key);
        });

        for (let column of rows) {
            let formatted = column
                .replaceAll(",", " ")
                .replaceAll(";", " ")
                .replaceAll(":", " ")
                .replaceAll("(", " ")
                .replaceAll(")", " ")
                .replaceAll("/", " ")
                .replaceAll(".", " ")
                .replaceAll("+", "P")
                .replaceAll("-", "M")
                .split(" ")
                .filter(Boolean)
                .map((slug) => {
                    // is a number
                    if (!isNaN(Number(slug))) {
                        return slug;
                    } else {
                        let mapper = {
                            cannot: (word) => `${[...word][0]}t`,
                            regular: (word) => `${[...word][0]}eg`,
                            without: (word) => `${[...word][0]}o`,
                            train: (word) => `${[...word][0]}n`,
                            little: (word) => `${[...word][0]}t`,
                            agnostic: (word) => `${[...word][0]}g`,
                            animism: (word) => `${[...word][0]}anm`,
                            deist: (word) => `${[...word][0]}de`,
                            druze: (word) => `${[...word][0]}dz`,
                            pantheism: (word) => `${[...word][0]}pan`,
                            ravidassia: (word) => `${[...word][0]}rav`,
                            rastafarian: (word) => `${[...word][0]}ras`,
                            scientology: (word) => `${[...word][0]}sci`,
                            satanism: (word) => `${[...word][0]}sat`,
                            shamanism: (word) => `${[...word][0]}sha`,
                            shintoism: (word) => `${[...word][0]}shin`,
                            wicca: (word) => `${[...word][0]}wi`,
                            spiritualist: (word) => `${[...word][0]}spir`,
                            taoist: (word) => `${[...word][0]}tao`,
                            theism: (word) => `${[...word][0]}the`,
                            valmiki: (word) => `${[...word][0]}val`,
                            polish: (word) => `${[...word][0]}pol`,
                            iraqi: (word) => `${[...word][0]}irq`,
                            southern: (word) => `${[...word][0]}so`,
                            latvian: (word) => `${[...word][0]}lat`,
                            lithuanian: (word) => `${[...word][0]}lit`,
                            greek: (word) => `${[...word][0]}gre`,
                            german: (word) => `${[...word][0]}ger`,
                            swedish: (word) => `${[...word][0]}swe`,
                            slovak: (word) => `${[...word][0]}slo`,
                            danish: (word) => `${[...word][0]}dan`,
                            dutch: (word) => `${[...word][0]}dut`,
                            tamil: (word) => `${[...word][0]}tam`,
                            telugu: (word) => `${[...word][0]}tel`,
                            malayalam: (word) => `${[...word][0]}mal`,
                            marathi: (word) => `${[...word][0]}mar`,
                            akan: (word) => `${[...word][0]}ak`,
                            amharic: (word) => `${[...word][0]}am`,
                            lingala: (word) => `${[...word][0]}li`,
                            luganda: (word) => `${[...word][0]}lu`,
                            shona: (word) => `${[...word][0]}sh`,
                            somali: (word) => `${[...word][0]}so`,
                            arab: (word) => `${[...word][0]}ar`,
                            afghan: (word) => `${[...word][0]}af`,
                            iranian: (word) => `${[...word][0]}ira`,
                            indonesian: (word) => `${[...word][0]}in`,
                            korean: (word) => `${[...word][0]}ko`,
                            kashmiri: (word) => `${[...word][0]}ka`,
                            sinhalese: (word) => `${[...word][0]}si`,
                            sikh: (word) => `${[...word][0]}sk`,
                            thai: (word) => `${[...word][0]}th`,
                            taiwanese: (word) => `${[...word][0]}tw`,
                            ethiopian: (word) => `${[...word][0]}et`,
                            eritrean: (word) => `${[...word][0]}er`,
                            ghanaian: (word) => `${[...word][0]}gh`,
                            gambian: (word) => `${[...word][0]}gm`,
                            moroccan: (word) => `${[...word][0]}mo`,
                            malawian: (word) => `${[...word][0]}ma`,
                            sudanese: (word) => `${[...word][0]}sd`,
                            somalilander: (word) => `${[...word][0]}sod`,
                            zimbabwean: (word) => `${[...word][0]}zw`,
                            zambian: (word) => `${[...word][0]}zm`,
                            chinese: (word) => `${[...word][0]}ch`,
                            caribbean: (word) => `${[...word][0]}car`,
                            african: (word) => `${[...word][0]}afr`,
                            algerian: (word) => `${[...word][0]}alg`,
                            albanian: (word) => `${[...word][0]}alb`,
                            armenian: (word) => `${[...word][0]}arm`,
                            argentinian: (word) => `${[...word][0]}arg`,
                            belgian: (word) => `${[...word][0]}bel`,
                            belarusian: (word) => `${[...word][0]}blr`,
                            brazilian: (word) => `${[...word][0]}bra`,
                            bosnian: (word) => `${[...word][0]}bos`,
                            cornish: (word) => `${[...word][0]}cor`,
                            colombian: (word) => `${[...word][0]}col`,
                            czech: (word) => `${[...word][0]}cze`,
                            croatian: (word) => `${[...word][0]}cro`,
                            french: (word) => `${[...word][0]}fre`,
                            finnish: (word) => `${[...word][0]}fin`,
                            israeli: (word) => `${[...word][0]}is`,
                            irish: (word) => `${[...word][0]}irs`,
                            italian: (word) => `${[...word][0]}ita`,
                            kurdish: (word) => `${[...word][0]}kur`,
                            kosovan: (word) => `${[...word][0]}kos`,
                            moldovan: (word) => `${[...word][0]}mol`,
                            maltese: (word) => `${[...word][0]}mal`,
                            romanian: (word) => `${[...word][0]}rom`,
                            roma: (word) => `${[...word][0]}ro`,
                            russian: (word) => `${[...word][0]}rus`,
                            slovakian: (word) => `${[...word][0]}slk`,
                            serbian: (word) => `${[...word][0]}ser`,
                            spanish: (word) => `${[...word][0]}spa`,
                            slovenian: (word) => `${[...word][0]}sln`,
                            jewish: (word) => `${[...word][0]}jew`,
                            japenese: (word) => `${[...word][0]}jpn`,
                            muslim: (word) => `${[...word][0]}mus`,
                            mexican: (word) => `${[...word][0]}mex`,
                            punjabi: (word) => `${[...word][0]}pun`,
                            pakistani: (word) => `${[...word][0]}pak`,
                            portuguese: (word) => `${[...word][0]}por`,
                            poland: (word) => `${[...word][0]}pol`,
                            portugal: (word) => `${[...word][0]}port`,
                            iran: (word) => `${[...word][0]}ira`,
                            iraq: (word) => `${[...word][0]}irq`,
                            italy: (word) => `${[...word][0]}ita`,
                            ireland: (word) => `${[...word][0]}irl`,
                            spain: (word) => `${[...word][0]}spa`,
                            three: (word) => `3`,
                            two: (word) => `2`,
                        };

                        let defaultMapper = (word) => [...word][0];

                        let code = (
                            mapper[slug.toLowerCase()] ?? defaultMapper
                        )(slug);

                        let result = fileCode.endsWith("asp")
                            ? `${code}asp`
                            : code;

                        return result.toUpperCase();
                    }
                })
                .join("");

            if (codeMap[formatted]) {
                if (
                    ["OcTAura16yaoietwbtc", "NiAocooUi"]
                        .map((i) => i.toUpperCase())
                        .includes(formatted)
                ) {
                    continue;
                }

                $logger.warn(
                    {
                        column,
                        formatted,
                        alreadySet: codeMap[formatted],
                        fileCode,
                        previousFileCode:
                            columnMap[codeMap[formatted]].fileCode,
                    },
                    `repeated column, aborting...`
                );

                return process.exit(0);
            }

            codeMap[formatted] = column;

            columnMap[column] = {
                key: formatted,
                fileCode: fileCode,
            };
        }
    }

    return columnMap;
}
