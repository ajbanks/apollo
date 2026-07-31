import { resolve } from "path";
import { $logger } from "../../../utils/logger";
import { $csv } from "../../../utils/csv";
import { jsonStringify, parallelize } from "@bahatron/utils/lib/helpers";
import { $pg } from "../../../services/postgres";
import { dumpFile } from "../../../utils/dump-file";
import { Decimal } from "../../../utils/number-helpers";
import { globSync } from "fs";
import { EpcCertificate } from "../../../models/db/epc-england";
import { CliCommand } from "../../../app/cli-command";
import moment from "moment";
import { EpcToPropertyTypeMap } from "../../properties/property-type.values";

export const LoadLandRegistryEnglandCmd = CliCommand({
    name: "load-epc-england-file",
    options: {
        type: {
            string: true,
            demandOption: true,
            choices: ["domestic", "commercial"] as const,
        },
        path: {
            string: true,
            demandOption: true,
        },
    },
    handler: async (options) => {
        await loadEpcFiles(options);
    },
});

export async function loadEpcFiles({
    type,
    path,
}: {
    path: string;
    type: EpcCertificate["epc_type"];
}) {
    $logger.info(`parsing epc certificates...`);

    let start = moment().startOf("day").toDate();

    /** @todo make this an argument */
    let files = globSync(`${path}/**/certificates.csv`);

    let failed: any[] = [];

    async function flushData(data) {
        let parsed = data.map((item) => {
            return toDatabaseEntry({
                ...item,
                publish_date: start,
                epc_type: type,
            });
        });

        await $pg
            .table(`epc_data_england`)
            .insert(parsed)
            .onConflict("id")
            .ignore();
    }

    await parallelize({
        queue: files,
        workers: 10,
        handler: async (fileName) => {
            let items: any[] = [];
            let data = await $csv.readCsvStream(
                resolve(process.cwd(), fileName)
            );

            for await (let item of data) {
                items.push(item);

                if (items.length >= 500) {
                    try {
                        await flushData(items);

                        $logger.info(`chunk inserted`);
                    } catch (err) {
                        $logger.warn(err);
                        failed = failed.concat(items);
                    } finally {
                        items = [];
                    }
                }
            }

            if (items.length) {
                await flushData(items);
            }
        },
    });

    await dumpFile(`failed_epc_entries.json`, jsonStringify(failed, null, 4));
}

function toDatabaseEntry(item): EpcCertificate {
    return {
        id: item.LMK_KEY,
        address: item.ADDRESS,
        postcode: item.POSTCODE,
        building_reference_number: item.BUILDING_REFERENCE_NUMBER,
        current_epc_rating:
            item.CURRENT_ENERGY_RATING ?? item.ASSET_RATING_BAND ?? null,
        potential_epc_rating: item.POTENTIAL_ENERGY_RATING ?? null,
        current_energy_efficiency:
            item.CURRENT_ENERGY_EFFICIENCY ?? item.ASSET_RATING ?? null,
        potential_energy_efficiency: item.POTENTIAL_ENERGY_EFFICIENCY || null,
        property_type: item.PROPERTY_TYPE,
        built_form: item.BUILT_FORM,
        inspection_date: item.INSPECTION_DATE || null,
        lodgement_date: item.LODGEMENT_DATE || null,
        transaction_type: item.TRANSACTION_TYPE,
        environment_impact_current: Decimal(item.ENVIRONMENT_IMPACT_CURRENT),
        environment_impact_potential: Decimal(
            item.ENVIRONMENT_IMPACT_POTENTIAL
        ),
        energy_consumption_current: Decimal(item.ENERGY_CONSUMPTION_CURRENT),
        energy_consumption_potential: Decimal(
            item.ENERGY_CONSUMPTION_POTENTIAL
        ),
        co2_emissions_current: Decimal(item.CO2_EMISSIONS_CURRENT),
        co2_emiss_curr_per_floor_area: Decimal(
            item.CO2_EMISS_CURR_PER_FLOOR_AREA
        ),
        co2_emissions_potential: Decimal(item.CO2_EMISSIONS_POTENTIAL),
        lighting_cost_current: Decimal(item.LIGHTING_COST_CURRENT),
        lighting_cost_potential: Decimal(item.LIGHTING_COST_POTENTIAL),
        heating_cost_current: Decimal(item.HEATING_COST_CURRENT),
        heating_cost_potential: Decimal(item.HEATING_COST_POTENTIAL),
        hot_water_cost_current: Decimal(item.HOT_WATER_COST_CURRENT),
        hot_water_cost_potential: Decimal(item.HOT_WATER_COST_POTENTIAL),
        total_floor_area: Number(item.TOTAL_FLOOR_AREA ?? item.FLOOR_AREA),
        energy_tariff: item.ENERGY_TARIFF,
        mains_gas_flag: item.MAINS_GAS_FLAG,
        floor_level: item.FLOOR_LEVEL,
        flat_top_storey: item.FLAT_TOP_STOREY,
        flat_storey_count: item.FLAT_STOREY_COUNT,
        main_heating_controls: item.MAIN_HEATING_CONTROLS,
        multi_glaze_proportion: item.MULTI_GLAZE_PROPORTION,
        glazed_type: item.GLAZED_TYPE,
        glazed_area: item.GLAZED_AREA,
        extension_count: item.EXTENSION_COUNT,
        number_habitable_rooms: item.NUMBER_HABITABLE_ROOMS || null,
        number_heated_rooms: item.NUMBER_HEATED_ROOMS || null,
        low_energy_lighting: item.LOW_ENERGY_LIGHTING,
        number_open_fireplaces: item.NUMBER_OPEN_FIREPLACES,
        hotwater_description: item.HOTWATER_DESCRIPTION,
        hot_water_energy_eff: item.HOT_WATER_ENERGY_EFF,
        hot_water_env_eff: item.HOT_WATER_ENV_EFF,
        floor_description: item.FLOOR_DESCRIPTION,
        floor_energy_eff: item.FLOOR_ENERGY_EFF,
        floor_env_eff: item.FLOOR_ENV_EFF,
        windows_description: item.WINDOWS_DESCRIPTION,
        windows_energy_eff: item.WINDOWS_ENERGY_EFF,
        windows_env_eff: item.WINDOWS_ENV_EFF,
        walls_description: item.WALLS_DESCRIPTION,
        walls_energy_eff: item.WALLS_ENERGY_EFF,
        walls_env_eff: item.WALLS_ENV_EFF,
        secondheat_description: item.SECONDHEAT_DESCRIPTION,
        sheating_energy_eff: item.SHEATING_ENERGY_EFF,
        sheating_env_eff: item.SHEATING_ENV_EFF,
        roof_description: item.ROOF_DESCRIPTION,
        roof_energy_eff: item.ROOF_ENERGY_EFF,
        roof_env_eff: item.ROOF_ENV_EFF,
        mainheat_description: item.MAINHEAT_DESCRIPTION,
        mainheat_energy_eff: item.MAINHEAT_ENERGY_EFF,
        mainheat_env_eff: item.MAINHEAT_ENV_EFF,
        mainheatcont_description: item.MAINHEATCONT_DESCRIPTION,
        mainheatc_energy_eff: item.MAINHEATC_ENERGY_EFF,
        mainheatc_env_eff: item.MAINHEATC_ENV_EFF,
        lighting_description: item.LIGHTING_DESCRIPTION,
        lighting_energy_eff: item.LIGHTING_ENERGY_EFF,
        lighting_env_eff: item.LIGHTING_ENV_EFF,
        main_fuel: item.MAIN_FUEL,
        wind_turbine_count: item.WIND_TURBINE_COUNT,
        heat_loss_corridor: item.HEAT_LOSS_CORRIDOR,
        unheated_corridor_length: item.UNHEATED_CORRIDOR_LENGTH,
        floor_height: item.FLOOR_HEIGHT,
        photo_supply: item.PHOTO_SUPPLY,
        solar_water_heating_flag: item.SOLAR_WATER_HEATING_FLAG,
        mechanical_ventilation: item.MECHANICAL_VENTILATION,
        construction_age_band: item.CONSTRUCTION_AGE_BAND,
        lodgement_datetime: item.LODGEMENT_DATETIME || null,
        tenure: item.TENURE,
        fixed_lighting_outlets_count: item.FIXED_LIGHTING_OUTLETS_COUNT,
        low_energy_fixed_light_count: item.LOW_ENERGY_FIXED_LIGHT_COUNT,
        uprn: item.UPRN,
        uprn_source: item.UPRN_SOURCE,
        publish_date: item.publish_date,
        epc_type: item.epc_type,
    };
}
