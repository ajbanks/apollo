import {
    GetObjectCommand,
    HeadObjectCommand,
    PutObjectCommand,
    DeleteObjectCommand,
    S3Client,
} from "@aws-sdk/client-s3";
import { $env } from "../utils/env";
import { ExpectationFailed, NotFound } from "@bahatron/utils/lib/error";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { $logger } from "../utils/logger";
import { RequestPresigningArguments } from "@smithy/types";

const BUCKET_NAME = "property-images";

const client = new S3Client({
    endpoint: "https://s3.us-west-004.backblazeb2.com",
    region: "us-west-004",
    credentials: {
        accessKeyId: $env.S3_CREDENTIAL_KEY!,
        secretAccessKey: $env.S3_CREDENTIAL_SECRET!,
    },
    forcePathStyle: true,
});

client.middlewareStack.add(
    (next) => async (args: any) => {
        return next(args);
    },
    {
        override: true,
        step: "finalizeRequest",
    }
);

client.middlewareStack.remove("flexibleChecksumsMiddleware");

export const $imageBucket = {
    async insert({
        key,
        data,
        type,
    }: {
        key: string;
        data: Buffer;
        type: string;
    }) {
        try {
            let result = await client.send(
                new PutObjectCommand({
                    Bucket: BUCKET_NAME,
                    Body: data,
                    Key: key,
                    ContentType: type,
                    Metadata: {
                        content_type: type,
                    },
                })
            );

            $logger.debug(result, `image uploaded`);
        } catch (err) {
            $logger.warn(err);
            throw err;
        }
    },

    async fetchImageBuffer({ key }) {
        let data = await client.send(
            new GetObjectCommand({
                Bucket: BUCKET_NAME,
                Key: key,
            })
        );

        if (!data.Body || !data.Metadata) {
            throw ExpectationFailed("IMAGE_NOT_FOUND");
        }

        let buffer = Buffer.from(await data.Body.transformToByteArray());

        return {
            data: buffer,
            type: data.Metadata.content_type,
        };
    },

    async createImageUrl(
        { key },
        options: RequestPresigningArguments = {
            expiresIn: 3599 * (24 * 7),
        }
    ) {
        let img = await client.send(
            new HeadObjectCommand({
                Bucket: BUCKET_NAME,
                Key: key,
            })
        );

        let url = await getSignedUrl(
            client,
            new GetObjectCommand({
                Bucket: BUCKET_NAME,
                Key: key,
                ResponseContentDisposition: "inline",
                ResponseContentType: img.Metadata!.content_type,
            }),
            options
        );

        return url;
    },

    async delete({ key }: { key: string }) {
        try {
            await client.send(
                new HeadObjectCommand({
                    Bucket: BUCKET_NAME,
                    Key: key,
                })
            );

            let result = await client.send(
                new DeleteObjectCommand({
                    Bucket: BUCKET_NAME,
                    Key: key,
                })
            );

            $logger.debug(result, `image deleted`);
        } catch (err: any) {
            if (err.name === "NotFound") return;

            $logger.warn(err);
            throw err;
        }
    },
};
