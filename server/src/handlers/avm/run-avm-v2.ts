import { $julia } from "../../services/julia";
import { $slack } from "../../services/slack";
import { $schema, Static } from "../../utils/json-schema";
import { $logger } from "../../utils/logger";

const Valuation = $schema.Object({
    estimate: $schema.Number(),
    low: $schema.Number(),
    high: $schema.Number(),
    central_error: $schema.Number(),
});

/** @todo spread across categorical and quantitative */
const fieldNames = [
    "floor_level_int",
    "has_garden",
    "council_tax_band",
    "bedrooms",
    "has_parking",
    "flat_storey_count",
    "ownership_type",
    "new_build",
    "garden_area_sqm",
    "occupation_type",
    "total_floor_area",
    "year_built_normalised",
    "plot_area_sqm",
    "postcode",
    "prop_type",
    "num_habitable_rooms",
    "extensions",
] as const;

const categoricalFields = ["has_garden", "has_parking"] as const;

const quantitativeFields = [
    "floor_level_int",
    "council_tax_band",
    "bedrooms",
] as const;

export type AvmResultV2 = Static<typeof AvmResultV2Schema>;
export const AvmResultV2Schema = $schema.Nullable(
    $schema.Object({
        sales: Valuation,
        rents: Valuation,
        imputed: $schema.Object({
            quantitative: $schema.Optional(
                $schema.Record(
                    $schema.Union(
                        quantitativeFields.map((k) => $schema.Literal(k))
                    ),
                    $schema.Optional(
                        $schema.Array(
                            $schema.Array($schema.Nullable($schema.Number())),
                            {
                                maxItems: 2,
                                minItems: 2,
                            }
                        )
                    )
                )
            ),
            categorical: $schema.Optional(
                $schema.Record(
                    $schema.Union(
                        categoricalFields.map((k) => $schema.Literal(k))
                    ),
                    $schema.Optional(
                        $schema.Array(
                            $schema.Array($schema.Nullable($schema.Number())),
                            {
                                maxItems: 2,
                                minItems: 2,
                            }
                        )
                    )
                )
            ),
        }),
        known: $schema.Record(
            $schema.Union(
                [...quantitativeFields, ...categoricalFields].map((k) => {
                    return $schema.Literal(k);
                })
            ),
            $schema.Optional($schema.String())
        ),
    })
);

/**
 * @todo cache result for 1 week per UPRN
 */
export async function runAvmByUprn(
    uprns: string[]
): Promise<Record<string, AvmResultV2>> {
    let { data } = await $julia({
        method: "get",
        url: "/uprn",
        params: {
            uprns: uprns.join(","),
        },
    });

    $logger.debug(data, "result from running AVM");

    let errors = Object.entries(data).filter(([key, value]: any) => {
        return Boolean(value.error);
    });

    if (errors.length) {
        await $slack.sendMessage({
            channel: $slack.ERROR_NOTIFICATIONS,
            text: `[AVM service]: Got an error running AVM`,
            context: errors,
        });
    }

    return Object.entries(data).reduce((fold, [key, value]: any) => {
        fold[key] = value.error ? null : value;
        return fold;
    }, {});
}
