import { ExpectationFailed } from "@bahatron/utils/lib/error";
import {
    $titleDocuments,
    TitleDocumentStatus,
} from "../../models/db/title-documents";
import { $titleMeta } from "../../models/db/title-meta";
import { $logger } from "../../utils/logger";
import { ProcessTitleDocumentDownloadQueue } from "./process-document-download.queue";

export async function downloadDeedDocuments({
    titleNumber,
    reference,
    plan,
    webhook,
}: {
    titleNumber: string;
    reference: string;
    plan: boolean;
    webhook: string;
}) {
    let meta = await $titleMeta
        .knex()
        .where({ title: titleNumber })
        .orderBy("date", "desc")
        .first();

    let checks = {
        known_title: Boolean(meta),
        available_plan: !plan
            ? true
            : meta?.availability.title_plan.availability_code !== "UNAVAILABLE",
    };

    if (!Object.values(checks).every(Boolean)) {
        $logger.warn(checks, "download title documents validation failed");

        throw ExpectationFailed(checks, "VALIDATION_FAILED");
    }

    await $titleDocuments.knex().insert({
        reference,
        titleNumber,
        plan,
        status: TitleDocumentStatus.QUEUED,
    });

    await ProcessTitleDocumentDownloadQueue.add({
        reference,
        webhook,
    });
}
