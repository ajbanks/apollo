import axios from "axios";
import { groupBy } from "lodash";
import { CliCommand } from "../../../app/cli-command";
import { $pg } from "../../../services/postgres";
import { $logger } from "../../../utils/logger";
import { quantile } from "../../../utils/quantile";
import { $propertyListings } from "../../../models/db/property-listings";
import { dumpFile } from "../../../utils/dump-file";
import { foldStream } from "../fold-rm-stream";
import {
    jsonParse,
    jsonStringify,
    parallelize,
} from "@bahatron/utils/lib/helpers";
import { $proxyV2 } from "../../../services/proxy";
import { $openai } from "../../../services/openai";
import { $axios } from "../../../utils/axios";
import { text } from "stream/consumers";
import { POSTCODE_REGEX } from "../../addresses/postcode.utils";
import { $csv } from "../../../utils/csv";

const TABLE_NAME = `poc_rm_agents`;

const OPENAI_CONTACT_SCHEMA = {
    type: "object",
    additionalProperties: false,
    required: ["website_url", "phone_number", "email"],
    properties: {
        website_url: {
            type: ["string", "null"],
            description:
                "Public website URL for the agency. Include scheme and strip tracking params.",
        },
        phone_number: {
            type: ["string", "null"],
            description:
                "Primary phone number as dialable text (E.164 preferred, include country code).",
        },
        email: {
            type: ["array", "null"],
            description:
                "List of contact emails discovered on official sources. Leave null when unavailable.",
            items: {
                type: "string",
            },
        },
    },
} as const;

const CONTACT_SYSTEM_PROMPT =
    "You are an assistant that researches UK real estate agencies using built-in internet search. " +
    "For the provided agency name and address, locate the official contact website, the best public phone number, " +
    "and every published contact email. Prefer authoritative sources, verify consistency, and answer only with the requested JSON schema.";

const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
function extractEmails(text: string): string[] {
    return Array.from(text.matchAll(emailRegex), (m) => m[0]) || [];
}

const phoneRegex =
    /(?<!\d)(?=(?:\D*\d){7,})(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?){1,2}\d{3,4}[\s.-]?\d{3,4}(?!\d)/g;
function extractPhones(text: string): string[] {
    return Array.from(text.matchAll(phoneRegex), (m) => m[0]) || [];
}

export const CrawlAgentsDataCmd = CliCommand({
    name: "crawl-agents-data",
    handler: async () => {
        // await enrichTest();
        await report();
    },
});

async function report() {
    let sample = await $pg.table(TABLE_NAME).whereNotNull("serapi_raw");

    let report = sample.map((agent) => {
        let serpEmails = extractEmails(jsonStringify(agent.serapi_raw));
        let placesEmails = extractEmails(jsonStringify(agent.places_raw));

        return {
            id: agent.id,
            display_name: agent.display_name,
            address: agent.address,
            postcode:
                agent.address
                    .split(",")
                    .map((s) => s.trim().toUpperCase())
                    .filter((s) => POSTCODE_REGEX.test(s))[0] || null,

            serp_website: agent.serapi_raw?.knowledge_graph?.website ?? null,
            serp_phone: agent.serapi_raw?.knowledge_graph?.phone ?? null,
            serp_email: serpEmails.length
                ? Array.from(new Set(serpEmails))
                : null,

            openai_website: agent.openai_raw?.output?.website_url ?? null,
            openai_phone: agent.openai_raw?.output?.phone_number ?? null,
            openai_email: agent.openai_raw?.output?.email ?? null,

            places_website: agent.places_raw?.places?.[0]?.websiteUri ?? null,
            places_phone:
                agent.places_raw?.places?.[0]?.internationalPhoneNumber ?? null,
            places_email: placesEmails.length
                ? Array.from(new Set(placesEmails))
                : null,

            web_crawl_emails: agent.website_search?.emails ?? null,
            web_crawl_phones: agent.website_search?.phones ?? null,
        };
    });

    await dumpFile(`rm-agent-crawl-report.csv`, $csv.jsonToCsv(report));
}

async function enrichTest() {
    let sample = await $pg.table(TABLE_NAME).whereNotNull("serapi_raw");

    for (let agent of sample) {
        let website =
            agent.serapi_raw?.knowledge_graph?.website ??
            agent.openai_raw?.output?.website_url ??
            agent.places_raw?.places?.[0]?.websiteUri;

        if (!website) continue;

        let val = await websiteCrawlTest(website);

        await $pg.table(TABLE_NAME).where({ id: agent.id }).update({
            website_search: val,
        });
    }
}

async function websiteCrawlTest(websiteUrl: string) {
    try {
        let { data: html } = await $proxyV2({
            url: websiteUrl,
        });

        let extractedEmails = extractEmails(html);
        let extractedPhones = extractPhones(html);

        return {
            emails: extractedEmails.length
                ? Array.from(new Set(extractedEmails))
                : null,
            phones: extractedPhones.length
                ? Array.from(new Set(extractedPhones))
                : null,
        };
    } catch (err) {
        $logger.warn(err);

        return null;
    }
}

async function placesApiTest(agent: any) {
    let apiKey = process.env.GOOGLE_PLACES_API_KEY!;

    let { data } = await $axios({
        method: "post",
        url: `https://places.googleapis.com/v1/places:searchText?fields=*&key=${apiKey}`,
        // headers: {
        //     Authorization: `Bearer ${apiKey}`,
        // },
        data: {
            textQuery: `${agent.display_name} ${agent.address}`,
        },
    });

    return data;
}

async function openAItest(agent: any) {
    let res = await $openai.client.responses.create({
        model: "gpt-5-mini",
        reasoning: { effort: "low" },
        tools: [
            {
                type: "web_search",
                search_context_size: "low",
                user_location: {
                    country: "GB",
                    type: "approximate",
                },
            },
        ],

        input: [
            {
                role: "system",
                content: CONTACT_SYSTEM_PROMPT,
            },
            { role: "user", content: `${agent.display_name} ${agent.address}` },
        ],

        text: {
            format: {
                name: "response",
                type: "json_schema",
                strict: true,
                schema: OPENAI_CONTACT_SCHEMA,
            },
        },
    });

    $logger.info(
        jsonParse(res.output_text),
        "response from OpenAI for agent id " + agent.id
    );

    await dumpFile(
        `agent_${agent.id}_openai_response.json`,
        jsonStringify(res, null, 4)
    );

    return {
        output: jsonParse(res.output_text),
        usage: res.usage,
    };
}

async function auditSerpResults() {
    let data = await $pg.table(TABLE_NAME).whereNotNull(`serapi_raw`);

    let stats = {
        total: data.length,
        total_with_website: data.filter((d) => d.website_url).length,
        total_with_phone: data.filter((d) => d.phone_number).length,
        total_with_email: data.filter((d) => d.email).length,
        total_with_full_contact: data.filter((d) => d.phone_number && d.email)
            .length,
    };

    await dumpFile(
        `problematic_agents.json`,
        jsonStringify(
            data.filter((d) => !d.website_url && d.phone_number && d.email),
            null,
            4
        )
    );

    $logger.info(stats);
}

async function crawlAgentWebsitesSerpAPI() {
    let agents = await $pg.table(TABLE_NAME).whereNull(`serapi_raw`).stream();

    for await (let agent of agents) {
        let { data: response } = await $proxyV2({
            url: "https://serpapi.com/search",
            params: {
                engine: "google",
                q: `${agent.display_name} ${agent.address}`,
                api_key: process.env.SERPAPI_API_KEY!,
            },
        });

        let websiteUrl = response?.knowledge_graph?.website
            ?.split("?")[0]
            .split()
            .shift();

        let phoneNumber = response?.knowledge_graph?.phone;

        let emails = extractEmails(jsonStringify(response));

        if (websiteUrl) {
            try {
                let { data: html } = await $proxyV2({
                    url: websiteUrl,
                });

                let extractedEmails = extractEmails(html);

                emails = emails.concat(extractedEmails);
            } catch (err: any) {
                $logger.warn({ agent_id: agent.id, websiteUrl }, err.message);
            }
        }

        await $pg
            .table(TABLE_NAME)
            .where({ id: agent.id })
            .update({
                serapi_raw: response,
                website_url: websiteUrl,
                phone_number: phoneNumber,
                email: emails.length ? Array.from(new Set(emails)) : null,
            });

        $logger.info({ agent_id: agent.id }, `updated agent`);
    }
}

async function createAgentTable() {
    await $pg.schema
        .createTableIfNotExists(TABLE_NAME, (table) => {
            table.string(`id`).primary();
            table.jsonb(`rm_raw`).notNullable();
            table.string(`branch_name`).index();
            table.string(`display_name`).index();
            table.string(`company_name`).index();
            table.string(`trading_name`).index();
            table.string(`address`).index();
            table.jsonb(`serapi_raw`);
            table.string(`website_url`);
            table.string(`phone_number`);
            table.specificType(`email`, "text[]");
        })
        .catch($logger.warn);

    let { rows: agents } = await $pg.raw(
        `
            SELECT DISTINCT agent_id
            FROM property_listings
            WHERE true
                AND last_added_at > NOW() - INTERVAL '180 days'
                AND agent_id IS NOT NULL
        `
    );

    await parallelize({
        workers: 5,
        queue: agents,
        handler: async ({ agent_id }) => {
            let prop = await $propertyListings
                .knex()
                .select(`id`)
                .where({ agent_id })
                .orderBy("last_added_at", "desc")
                .first();

            let fold = await foldStream(prop?.id.split(".").pop()!);

            let agent = fold.data.details.customer;

            await $pg
                .table(TABLE_NAME)
                .insert({
                    id: agent_id,
                    rm_raw: agent,
                    branch_name: agent.branchName,
                    display_name: agent.branchDisplayName,
                    company_name: agent.companyName,
                    trading_name: agent.companyTradingName,
                    address: agent.displayAddress
                        .replaceAll(`\r\n`, `, `)
                        .split(",")
                        .map((s) => s.trim())
                        .filter((s) => s)
                        .join(", "),
                })
                .catch((err) => {
                    $logger.warn({ agent_id }, err.message);
                });

            $logger.info({ agent_id }, `processed`);
        },
    });
}

async function checkAgentStats() {
    let result = await $pg.raw(
        `
            SELECT price, channel, agent_branch_name, bedrooms, bathrooms, uprn, last_added_at, exit_at, id, property_type, property_subtype
            FROM property_listings
            WHERE last_added_at > NOW() - INTERVAL '180 days'
        `
    );

    $logger.info(`listings from 180 days ago: ${result.rows.length}`);
    $logger.info(
        `listings wiith uprn: ${result.rows.filter((r) => r.uprn).length}`
    );

    let byAgent = groupBy(result.rows, (r) => r.agent_branch_name);

    $logger.info(`num agents: ${Object.keys(byAgent).length}`);

    let listingCount = Object.values(byAgent).map((arr) => arr.length);

    let quantile_10 = quantile(listingCount, 10);
    let quantile_50 = quantile(listingCount, 50);
    let quantile_90 = quantile(listingCount, 90);

    $logger.info(
        {
            quantile_10,
            quantile_50,
            quantile_90,
        },
        `quantile counts`
    );
}
