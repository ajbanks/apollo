import { ExpectationFailed } from "@bahatron/utils/lib/error";

export function TypeMapper(type: string) {
    if (type === "brma25") {
        return {
            code: (item) => {
                let member = item.properties["SW_MEMBER"];
                let locality = item.properties["LOCALITY_I"];
                return `BRMA${locality}${member}`.padEnd(9, "0");
            },

            display_name: (item) => item.properties["Name"],
        };
    }

    return {
        code: (item) => {
            let res = item.properties[`${type.toUpperCase()}CD`];
            if (!res) {
                throw ExpectationFailed({ type, item }, "CODE_NOT_FOUND");
            }
            return res;
        },

        display_name: (item) => {
            let res = item.properties[`${type.toUpperCase()}NM`];
            if (!res) {
                throw ExpectationFailed({ type, item }, "CODE_NOT_FOUND");
            }
            return res;
        },
    };
}
