import { RequestHandler } from "express";
import { $session } from "../session.service";
import { ulid } from "ulidx";

export const REQUEST_ID_MIDDLEWARE: RequestHandler = async (req, res, next) => {
    try {
        let requestId = (req.headers["x-request-id"] || ulid()) as string;

        $session.run({ requestId: requestId }, next);
    } catch (err) {
        return next(err);
    }
};
