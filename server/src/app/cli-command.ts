import { ArgumentsCamelCase, InferredOptionTypes, Options } from "yargs";

/**
 * @todo fix type hinting
 */
export interface CliCommand<T extends Record<string, Options> = any> {
    name: string;
    description?: string;
    options?: T;
    handler: (args: ArgumentsCamelCase<InferredOptionTypes<T>>) => any;
}

const _proto = {};
export function CliCommand<T extends Record<string, Options>>(
    command: CliCommand<T>
): CliCommand<T> {
    return Object.setPrototypeOf(command, _proto);
}

CliCommand.isCommand = (val: any): val is CliCommand => {
    return Object.getPrototypeOf(val) === _proto;
};
