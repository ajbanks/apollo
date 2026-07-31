import moment from "moment";
import { HmoRegistryProperty } from "../../../models/db/hmo-registry";

export const BRIGHTON_LOCATION_CODE = "E06000043";
export interface BrightonDataEntry {
    Reference: string;
    UPRN: string;
    "Licence Type": string;
    "HMO Address": string;
    "Ward Name": string;
    "Licence Issued Date": string;
    "Renewal Date": string;
    "Applicant Name": string;
    "Applicant Address ": string;
    "Agent Name": string;
    "Agent Address  ": string;
    "Property Use": string;
    Storeys: number;
    Households: number;
    "Permitted Occupiers": number;
    Bedrooms: number;
    "Living Rooms": number;
    "Total Rooms": number;
    Bathrooms: number;
    Kitchens: number;
    WCs: number;
    "Conditions Applied to Property": string;
}

export async function BrightonHmoMapper(
    item: BrightonDataEntry
): Promise<HmoRegistryProperty> {
    return {
        id: item.Reference,
        date_start: moment(
            item["Licence Issued Date"],
            "DD/MM/YYYY"
        ).toISOString(),
        date_end: moment(item["Renewal Date"], "DD/MM/YYYY").toISOString(),
        uprn: Number(item.UPRN).toString(),
        address: normaliseAddress(item["HMO Address"]),
        postcode: item["HMO Address"].split(`\n`).pop()!,
        license_holder: item["Applicant Name"],
        license_holder_address: normaliseAddress(item["Applicant Address "]),
        storyes: Number(item.Storeys) || null,
        bedrooms: Number(item.Bedrooms),
        bathrooms: Number(item.WCs) || null,
        living_rooms: Number(item["Living Rooms"]) || null,
        max_households: Number(item.Households) || null,
        max_occupiers: Number(item["Permitted Occupiers"]),
    };
}

function normaliseAddress(address: string) {
    return address
        .split(`\n`)
        .map((item) => item.trim())
        .join(", ");
}
