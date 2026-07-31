import { ExpectationFailed } from "@bahatron/utils/lib/error";
import { $idpAddresses } from "../../models/db/idp-addresses";
import { $idealPostcodes, FullAddress } from "../../services/ideal-postcodes";

const resolver = {
    id: $idealPostcodes.fetchAddressById,
    uprn: $idealPostcodes.fetchAddressByUPRN,
};

export async function resolveAddress(
    query: string,
    type: keyof typeof resolver
) {
    let address = await $idpAddresses.knex().where(type, query).first();

    if (address) return address;

    let idp = await resolver[type](query);

    if (!idp) {
        throw ExpectationFailed(
            {
                key: type,
                value: query,
            },
            "ADDRESS_NOT_FOUND"
        );
    }

    return upsertAddress(idp);
}

/**
 * @deprecated use resolveAddress
 */
export async function resolveAddressId(addressId: string) {
    let address = await $idpAddresses.knex().where("id", addressId).first();

    if (!address) {
        let idp = await $idealPostcodes.fetchAddressById(addressId);

        if (!idp) {
            throw ExpectationFailed(
                { address_id: addressId },
                "ADDRESS_ID_NOT_FOUND"
            );
        }

        return upsertAddress(idp);
    }

    return address;
}

async function upsertAddress(idp: FullAddress) {
    let record = {
        id: idp.id,
        timestamp: new Date(),
        postcode: idp.postcode,
        uprn: idp.uprn,
        udprn: idp.udprn?.toString(),
        data: idp,
    };

    let result = await $idpAddresses
        .knex()
        .insert(record)
        .onConflict("id")
        .merge()
        .returning("*");

    return result[0];
}
