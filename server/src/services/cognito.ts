import { URLSearchParams } from "url";
import { $axios } from "../utils/axios";
import { $env } from "../utils/env";
import { $logger } from "../utils/logger";

export interface CognitoUser {
    sub: string;
    email_verified: "true" | "false";
    given_name: string;
    family_name: string;
    email: string;
    username: string;
}

export const $cognito = {
    async getUserFromToken(token: string): Promise<CognitoUser> {
        let { data } = await $axios({
            url: `${$env.COGNITO_URL}/userInfo`,
            headers: {
                authorization: `Bearer ${token}`,
            },
        });

        $logger.debug(data, `cognito get user response`);

        return data;
    },

    async getTokensFromCode(code: string): Promise<{
        id_token: string;
        refresh_token: string;
        access_token: string;
    }> {
        let params = new URLSearchParams({
            grant_type: "authorization_code",
            code: code,
            client_id: $env.COGNITO_CLIENT_ID!,
            client_secret: $env.COGNITO_CLIENT_SECRET!,
            redirect_uri: $env.COGNITO_REDIRECT_URI!,
        });

        let { data } = await $axios({
            url: `${$env.COGNITO_URL}/token`,
            method: "post",
            data: params,
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
            },
        }).catch((err) => {
            $logger.warning(err.response.data);
            throw err;
        });

        return data;
    },
};
