#!/usr/bin/env -S tsx
// #!/usr/bin/env -S node --enable-source-maps

import { $logger } from "./utils/logger";
import yargs from "yargs";
import { CliCommand } from "./app/cli-command";
import { resolve } from "path";
import { execute } from "@bahatron/utils/lib/helpers";
import { InternalError } from "@bahatron/utils/lib/error";
import { globSync } from "fs";

execute(async () => {
    let _handler: Promise<any> | undefined = undefined;

    let fileNames = globSync(resolve(__dirname, "./**/*.cli.*"));

    let commands: Record<string, CliCommand> = {};

    for (let file of fileNames) {
        try {
            let module = require(file);

            Object.entries(module).forEach(([name, module]) => {
                if (CliCommand.isCommand(module)) {
                    if (commands[module.name]) {
                        console.error(
                            InternalError(
                                {
                                    name: module.name,
                                },
                                "DUPLICATED_CLI_COMMAND"
                            )
                        );
                        process.exit(-1);
                    }

                    commands[module.name] = module;
                }
            });
        } catch (err: any) {
            // ignore
        }
    }

    let sorted = Object.values(commands).sort((a, b) => {
        return a.name.localeCompare(b.name);
    });

    for (let command of sorted) {
        yargs.command(
            command.name,
            command.description ?? command.name,
            command.options ?? {},
            (args) => {
                _handler = command.handler(args);
            }
        );

        $logger.debug(`loaded command: ${command.name}`);
    }

    yargs.help().argv;

    if (_handler) {
        await _handler;
    } else {
        yargs.showHelp();
    }
});
