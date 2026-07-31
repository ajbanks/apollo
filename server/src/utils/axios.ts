import axios, { AxiosRequestConfig } from "axios";
import { $logger } from "./logger";

const client = axios.create();

export async function $axios<T = any>(params: AxiosRequestConfig) {
    try {
        return await client<T>(params);
    } catch (err) {
        $logger.warning(err);
        throw err;
    }
}
