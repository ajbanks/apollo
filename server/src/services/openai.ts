import OpenAI from "openai";

export const $openai = {
    client: new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
    }),

    EMBED_MODEL: "text-embedding-3-small",
};
