import knex, { Knex } from "knex";
import { $logger } from "./logger";
import { ExpectationFailed } from "@bahatron/utils/lib/error";

export const translateMongoQueryToKnex = (
    query: Knex.QueryBuilder,
    mongoQuery: any
) => {
    for (const key in mongoQuery) {
        if (mongoQuery.hasOwnProperty(key)) {
            const value = mongoQuery[key];

            // Direct equality check
            if (
                typeof value !== "object" ||
                Array.isArray(value) ||
                value === null
            ) {
                query.where(key, "=", value);
                continue;
            }

            for (const operator in value) {
                if (!value.hasOwnProperty(operator)) continue;

                const operand = value[operator];
                switch (operator) {
                    case "$gte":
                        query.where(key, ">=", operand);
                        break;
                    case "$lte":
                        query.where(key, "<=", operand);
                        break;
                    case "$gt":
                        query.where(key, ">", operand);
                        break;
                    case "$lt":
                        query.where(key, "<", operand);
                        break;
                    case "$eq":
                        query.where(key, "=", operand);
                        break;
                    case "$ne":
                        query.whereNot(key, "=", operand);
                        break;
                    case "$exists":
                        if (operand) {
                            query.whereNotNull(key);
                        } else {
                            query.whereNull(key);
                        }
                        break;
                    case "$in":
                        query.whereIn(key, operand);
                        break;
                    case "$nin":
                        query.whereNotIn(key, operand);
                        break;
                    default:
                        throw ExpectationFailed(
                            `Unsupported operator: ${operator}`
                        );
                }
            }
        }
    }

    $logger.debug(
        { mongoQuery, result: query.toString() },
        "translated mongo query"
    );

    return query;
};
