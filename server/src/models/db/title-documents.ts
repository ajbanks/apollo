import {
    GetObjectCommand,
    PutObjectAclCommand,
    PutObjectCommand,
    S3Client,
} from "@aws-sdk/client-s3";
import { $pg } from "../../services/postgres";
import { $env } from "../../utils/env";
import { $logger } from "../../utils/logger";
import { Gone } from "@bahatron/utils/lib/error";

export enum TitleDocumentStatus {
    COMPLETE = "COMPLETE",
    QUEUED = "QUEUED",
}

export interface TitleDocument {
    titleNumber: string;
    reference: string;
    plan: boolean;
    status: string;
}

export const $titleDocuments = {
    knex: (session = $pg) => session.table<TitleDocument>("title_documents"),
};

export const $titleDocumentsBucket = (() => {
    let BUCKET_NAME = "propexum-title-documents";

    let client = new S3Client({
        endpoint: "https://s3.us-west-004.backblazeb2.com",
        region: "us-west-004",
        credentials: {
            accessKeyId: $env.S3_CREDENTIAL_KEY!,
            secretAccessKey: $env.S3_CREDENTIAL_SECRET!,
        },
        forcePathStyle: true,
    });

    return {
        async insert({ reference, data }) {
            let result = await client.send(
                new PutObjectCommand({
                    Bucket: BUCKET_NAME,
                    Body: data,
                    Key: reference,
                    ContentType: "application/zip",
                })
            );

            $logger.debug(result, `title document uploaded`);
        },

        async fetch({ reference }) {
            let data = await client.send(
                new GetObjectCommand({
                    Bucket: BUCKET_NAME,
                    Key: reference,
                })
            );

            if (!data.Body) {
                throw Gone("Document not found");
            }

            return Buffer.from(await data.Body.transformToByteArray());
        },
    };
})();
