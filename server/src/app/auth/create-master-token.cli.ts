import { CliCommand } from "../cli-command";
import { $jwt } from "../../utils/jwt";
import { $logger } from "../../utils/logger";

export const CreateMasterTokenCommand = CliCommand({
    name: "create-master-token",
    handler: async () => {
        let token = await $jwt.generate({});

        $logger.info(token);
    },
});
