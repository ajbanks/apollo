import mercurios from "@bahatron/mercurios";
import { $env } from "../utils/env";

export const $mercurios = mercurios({
    url: $env.DATABASE_URL,
});
