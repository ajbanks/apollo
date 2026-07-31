import jwt from "jsonwebtoken";
import { $env } from "./env";

export const $jwt = {
    generate(data: any, options: jwt.SignOptions = {}) {
        return jwt.sign(data, $env.JWT_SECRET, options);
    },
    decode(token: string) {
        return jwt.decode(token);
    },
    verify(token: string) {
        return jwt.verify(token, $env.JWT_SECRET);
    },
};
