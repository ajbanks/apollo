import { AsyncLocalStorage } from "node:async_hooks";
import { ApiKey } from "../models/db/api-keys";

export const $session = new AsyncLocalStorage<{
    requestId?: string;
    process?: string;
    session?: ApiKey;
}>();
