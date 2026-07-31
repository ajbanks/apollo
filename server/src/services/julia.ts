import axios from "axios";
import { $env } from "../utils/env";

export const $julia = axios.create({
    baseURL: $env.JULIA_SERVICE_URL,
});
