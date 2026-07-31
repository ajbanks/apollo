import { ulid } from "ulidx";
import { $pg } from "../../services/postgres";
import { CliCommand } from "../../app/cli-command";
import { $apiKeys } from "../../models/db/api-keys";
import { $apiClients } from "../../models/db/api-clients";
import { ApiPermissions } from "./api-permissions.enum";
import { ExpectationFailed } from "@bahatron/utils/lib/error";
import { faker } from "@faker-js/faker";
import { $logger } from "../../utils/logger";

export const CreateApiClientCommand = CliCommand({
    name: "create-api-client",
    options: {
        name: {
            alias: "n",
            type: "string",
            demandOption: true,
        },
        permissions: {
            type: "array",
            alias: "p",
            items: {
                type: "string",
            },
            default: [],
        },
    },
    handler: createApiClient,
});

export async function createApiClient({ name, permissions }) {
    let id = ulid();

    if (
        permissions.some((p) => {
            return !Object.values(ApiPermissions).includes(p);
        })
    ) {
        throw ExpectationFailed(
            {
                valid_permissions: Object.values(ApiPermissions),
                provided_permissions: permissions,
            },
            `invalid permission provided`
        );
    }

    let result = await $pg.transaction(async (trx) => {
        await $apiClients.knex(trx).insert({
            id: id,
            name: name,
        });

        let result = await $apiKeys
            .knex(trx)
            .insert({
                client_id: id,
                key: faker.string.alphanumeric(64),
                enabled: true,
                permissions,
            })
            .returning("*");

        return result[0];
    });

    $logger.info(`key created: ${result.key}`);
}
