import moment from "moment";

export function StopWatch({ units }: { units: moment.unitOfTime.Diff }) {
    let start = moment();

    let laps: { name: string; time: moment.Moment }[] = [];

    return {
        lap(name: string) {
            laps.push({ name, time: moment() });
        },

        getResults() {
            let results: Record<string, string> = {};

            let previous = start;
            for (let lap of laps) {
                results[lap.name] = `${lap.time.diff(
                    previous,
                    units,
                    true
                )} ${units}`;
                previous = lap.time;
            }

            results["total"] = `${moment().diff(start, units, true)} ${units}`;

            return results;
        },
    };
}
