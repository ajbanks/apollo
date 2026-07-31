import { ExpectationFailed } from "@bahatron/utils/lib/error";
import { $idpAddresses } from "../../models/db/idp-addresses";
import { $titleMeta, TitleMeta } from "../../models/db/title-meta";
import moment from "moment";
import { $logger } from "../../utils/logger";
import { getTitleNumber } from "./get-title-number.request";
import { TenureTypeMap } from "./tenure-type.enum";
import { $slack } from "../../services/slack";
import { $session } from "../../app/session.service";
import { resolveAddress } from "../addresses/resolve-address";
import { $hmlr } from "./hmlr.service";
import { $env } from "../../utils/env";
import { omit, pick } from "lodash";
import { createHashKey } from "../../utils/create-hash-key";
import { jsonStringify, sleep } from "@bahatron/utils/lib/helpers";
import { dumpFile } from "../../utils/dump-file";
import { $titleUprnMap } from "../../models/db/title-uprn-map";

export async function getTitleMetaByUprn(
    uprn: string,
    { forceUpdate = false, noAddressResolve = true } = {}
) {
    try {
        if (forceUpdate) {
            await $titleUprnMap.knex().where({ uprn }).delete();
        }

        let sevenDaysAgo = moment().startOf("day").subtract(7, "days");

        let titleMap = await $titleUprnMap.knex().where({ uprn });

        let deeds = await $titleMeta.knex().whereIn(
            "title",
            titleMap.map((item) => item.title)
        );

        if (
            deeds.length &&
            deeds.every(({ date }) => moment(date).isAfter(sevenDaysAgo))
        ) {
            return deeds;
        }

        let address = await $idpAddresses.knex().where({ uprn }).first();

        if (!address) {
            if (noAddressResolve) {
                throw ExpectationFailed({ uprn }, "ADDRESS_NOT_MAPPED");
            }

            address = await resolveAddress(uprn, "uprn");
        }

        let titles = await getTitleNumber(address);

        let titleMeta = await Promise.all(
            titles.map(async (title): Promise<TitleMeta> => {
                let tenure =
                    TenureTypeMap[
                        title["TenureInformation"]["TenureTypeCode"]?.toString()
                    ];

                return {
                    id: createHashKey(
                        `${title.TitleNumber}:${tenure}:${jsonStringify(
                            title.Address
                        )}`
                    ),
                    title: title.TitleNumber,
                    tenure,
                    postcode: title.Address.PostcodeZone.Postcode,
                    date: new Date(),
                    meta: title,
                    availability: await getTitleDocumentAvailability(
                        title.TitleNumber
                    ),
                };
            })
        );

        // deduplicate records
        titleMeta = Object.values(
            titleMeta.reduce((fold, item) => {
                fold[item.id] = item;
                return fold;
            }, {} as Record<string, TitleMeta>)
        );

        await $titleMeta.knex().insert(titleMeta).onConflict("id").merge();

        await $titleUprnMap
            .knex()
            .insert(titleMeta.map((i) => ({ title: i.title, uprn })))
            .onConflict(["title", "uprn"])
            .ignore();

        // await dumpFile(
        //     `title-${uprn}.json`,
        //     jsonStringify(
        //         {
        //             address,
        //             titleMeta: titleMeta.map((i) => omit(i, ["availability"])),
        //         },
        //         null,
        //         4
        //     )
        // );

        return titleMeta;
    } catch (err: any) {
        if (err.message === "Request failed with status code 429") {
            await sleep(60_000);
            return getTitleMetaByUprn(uprn, { forceUpdate, noAddressResolve });
        }

        if (!forceUpdate) {
            await $slack.sendMessage({
                channel: $slack.ERROR_NOTIFICATIONS,
                text: "Failure fetching title metadata from UPRN",
                context: {
                    uprn,
                    error: err.message,
                    request_id: $session.getStore()?.requestId,
                    ...(err.context ?? {}),
                },
            });
        }

        throw err;
    }
}

async function getTitleDocumentAvailability(title: string) {
    let { data } = await $hmlr({
        method: "get",
        url: `https://businessgateway.landregistry.gov.uk/bg2/api/v2/titles/${title}/official-copies/availability`,
        auth: {
            username: $env.HMLR_USERNAME!,
            password: $env.HMLR_PASSWORD!,
        },
    });

    $logger.debug(data.data, "got HMLR title document availability response");

    return data.data;
}
