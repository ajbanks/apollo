import moment from "moment";
import { HmoRegistryProperty } from "../../../models/db/hmo-registry";
import { createItemId } from "./create-item-id.util";
import { $epcEngland } from "../../../models/db/epc-england";
import FuzzySet from "fuzzyset";
import { $logger } from "../../../utils/logger";

export const EASTBOURNE_DISTRICT_CODE = "E07000061";

interface EastbourneDataEntry {
    "Name of licence holder": string;
    "Address of licence holder": string;
    "Commencement date of licence": string;
    Duration: number;
    "Address of HMO": string;
    "Description of HMO": string;
    "No. of storeys": number;
    "No. of living rooms": string;
    "No. of bedrooms": string;
    "No. s/c flats": number;
    "No. non s/c flats": number;
    "shared sinks": number;
    "shared hand basins": number;
    "shared baths": number;
    "shared showers": number;
    "shared WCs": number;
    "max no. permitted persons": number;
}

export async function EastbourneHmoMapper(
    item: EastbourneDataEntry
): Promise<HmoRegistryProperty> {
    let date = moment(item["Commencement date of licence"], "DD/MM/YYYY");

    return {
        id: createItemId({
            district: EASTBOURNE_DISTRICT_CODE,
            address: item["Address of HMO"],
            date: item["Commencement date of licence"],
        }),
        address: item["Address of HMO"],
        postcode: item["Address of HMO"].split(",").pop()!.trim(),
        bedrooms: Number(item["No. of bedrooms"].split(` `).pop()),
        bathrooms: null,
        date_start: date.toISOString(),
        date_end: date.add(5, "years").toISOString(),
        license_holder: item["Name of licence holder"],
        license_holder_address: item["Address of licence holder"],
        max_occupiers: item["max no. permitted persons"],
        max_households: null,
        uprn: await matchUprnToAddress(item["Address of HMO"]),
        storyes: item["No. of storeys"],
        living_rooms: Number(item["No. of living rooms"].split(" ").pop()),
    };
}

async function matchUprnToAddress(address: string) {
    let postcode = address.split(",").pop()!.trim();

    let epcs = await $epcEngland.knex().where({ postcode });

    if (!epcs.length) return null;

    let epcUprn = epcs[0]?.uprn;

    if (epcs.every((item) => item.uprn == epcUprn)) {
        return epcUprn;
    }

    let set = FuzzySet(epcs.map((item) => item.address));

    let matchAddress = address
        .split("Eastbourne")
        .shift()!
        .trim()
        .replaceAll(",", "");

    let match = set.get(matchAddress);

    $logger.debug({ matchAddress, match: [match?.[0], match?.[1]] });

    if (!match || match[0][0] < 0.9) return null;

    let epc = epcs.find((item) => item.address === match[0][1]);

    let addressNumber = getAddressNumber(address);

    let epcNumber = getAddressNumber(epc!.address);

    $logger.debug({
        addressNumber,
        epcNumber,
    });

    if (epcNumber == addressNumber) {
        $logger.info(`uprn matched through fuzzy match`);
        return epc!.uprn;
    }

    return null;
}

function getAddressNumber(address: string) {
    return address
        .split(" ")
        .flatMap((item) => item.split(","))
        .find((item) => !isNaN(Number(item)) && Number(item) != 0);
}
