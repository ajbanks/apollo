import { CliCommand } from "../../app/cli-command";
import { scanContractsFromContractFinders } from "./scan-contract-finders-csv";

export const ScanContractFindersCommand = CliCommand({
    name: "scan-contract-finders",
    handler: scanContractsFromContractFinders,
});
