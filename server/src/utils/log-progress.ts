import { $logger } from "./logger";

export async function logProcess(
    process: (clicker: () => void) => any,
    processName?: string
) {
    let counter = 0;
    let clicks: number[] = [];
    let clicker = () => (counter += 1);

    let clickerInterval = setInterval(() => {
        clicks.push(counter);
        counter = 0;
    }, 1000);

    let loggerInterval = setInterval(() => {
        let total = clicks.reduce((partial, measure) => partial + measure, 0);
        $logger.info(
            {
                rate: `${(total / clicks.length).toFixed(2)}/sec`,
            },
            processName ?? process.name
        );

        clicks = [];
    }, 60000);

    await process(clicker);

    clearInterval(loggerInterval);
    clearInterval(clickerInterval);

    return;
}
