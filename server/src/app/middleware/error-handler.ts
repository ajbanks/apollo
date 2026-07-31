import { ErrorRequestHandler } from "express";
import { $logger } from "../../utils/logger";
import { $session } from "../session.service";
import { $slack } from "../../services/slack";

export const ERROR_HANDLER_MIDDLEWARE: ErrorRequestHandler = async (
    err,
    req,
    res,
    next
) => {
    let code =
        isNaN(err.code) || err.code >= 600 || err.code <= 100
            ? 500
            : parseInt(err.code);

    let requestId = $session.getStore()?.requestId;

    let context = {
        request_url: req.url,
        request_id: requestId,
        request_headers: req.headers,
        request_body: req.body,
        request_params: req.params,
        request_query: req.query,
        error: err.message,
        error_code: err.code,
        error_context: err.context,
    };

    $logger.warning(context, err.message);

    if (code >= 500) {
        await $slack
            .sendMessage({
                channel: $slack.ERROR_NOTIFICATIONS,
                text: `[Apollo] Unexpected Error - code: ${code}`,
                context,
            })
            .catch($logger.error);
    }

    res.status(code).json({
        error: err.message,
        context: err.context,
        request_id: requestId,
    });

    return;
};
