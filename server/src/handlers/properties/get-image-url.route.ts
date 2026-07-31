import { AUTHENTICATION_REQUIRED } from "../../app/middleware/auth-required";
import { Route } from "../../app/route";
import { $imageBucket } from "../../services/image-bucket";

export const GetImageUrlRoute = Route({
    method: "get",
    route: `/images/:id`,
    handler: [
        AUTHENTICATION_REQUIRED,
        async (req, res) => {
            let { id } = req.params;

            let url = await $imageBucket.createImageUrl({
                key: id,
            });

            res.status(200).json(url);
        },
    ],
});
