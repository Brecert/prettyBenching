import { BenchmarkResult, BenchmarkRunResult, bench, runBenchmarks } from "./deps.ts";
import { BenchIndicator } from "./types.ts";
import { prettyBenchmarkProgress } from "./pretty_benchmark_progress.ts";
import { prettyBenchmarkDown } from "./pretty_benchmark_down.ts";
import { calculateExtraMetrics, calculateStdDeviation } from "./common.ts";

export interface prettyBenchmarkHistoryOptions<T = unknown, K = unknown> {
    runExtras?: (runResult: BenchmarkRunResult) => K;
    benchExtras?: (result: BenchmarkResult) => T;
    onlyHrTime?: boolean; // TODO to allowLowPrecisionTime
    strict?: boolean; // TODO separate into allowRemoval, allowRunsCountChange, allowNew
    minRequiredRuns?: number;
    saveIndividualRuns?: boolean;
}

export interface BenchmarkHistory/*?Data?*/<T = unknown, K = unknown> {// TODO object so expandable without breaking API
    history: BenchmarkHistoryItem<T, K>[];
    // options?
}

// TODO BenchmarkHistoryRunSet
export interface BenchmarkHistoryItem<T = unknown, K = unknown> { // TODO this should be better because its grouped by runs, easier to remove old ones, or the last one for some reason
    date: Date; // TODO handle only strings?
    id?: string;
    runExtras?: K;

    benchmarks: {
        [key: string]:  BenchmarkHistoryRunItem<T>;
    };
}

export interface BenchmarkHistoryRunItem<T = unknown> {
    measuredRunsAvgMs: number;
    totalMs: number;
    runsCount: number;
    measuredRunsMs?: number[];
    extras?: T;
}

export interface Delta {
    percent: number;
    amount: number;
}

export class prettyBenchmarkHistory<T = unknown> {
    private data!: BenchmarkHistory<T>;
    private options?: prettyBenchmarkHistoryOptions<T>;

    constructor(options?: prettyBenchmarkHistoryOptions<T>, prev?: BenchmarkHistory<T>) {
        this.options = options;
 
        if(prev) {
            this.load(prev);
        } else {
            this.init();
        }
    }
    
    private init() {
        this.data = {history: []};
    }

    private load(prev: BenchmarkHistory<T>) {
        // TODO validate prev with options too?!
        this.data = prev;
    }

    addResults(runResults: BenchmarkRunResult, options?: {id?: string, date?: Date}) {
        const date = options?.date ?? new Date();

        // TODO checks

        const benchmarks: {[key: string]:  BenchmarkHistoryRunItem<T>} = {};
        runResults.results.forEach(r => {
            benchmarks[r.name] = {
                measuredRunsAvgMs: r.measuredRunsAvgMs,
                runsCount: r.runsCount,
                totalMs: r.totalMs,
                measuredRunsMs: this.options?.saveIndividualRuns ? r.measuredRunsMs : undefined,
                extras: this.options?.benchExtras && this.options.benchExtras(r)
            }
        });

        this.data.history.push({
            date,
            id: options?.id,
            runExtras: this.options?.runExtras &&this.options.runExtras(runResults),
            benchmarks: benchmarks,
        });

        // TODO sort history again;

        return this;
    }

    getDeltasFrom(results: BenchmarkRunResult, keys: (keyof T | "measuredRunsAvgMs" | "totalMs")[] = ["measuredRunsAvgMs"]): {[key: string]: {[key: string]: Delta}} {

        const deltas: {[key: string]: {[key:string]: Delta}} = {};

        results.results.forEach(r => {
            const d = this.getDeltaForBenchmark(r, keys);
            if(d){
                deltas[r.name] = d;
            }
        });

        return deltas;
    }

    getDeltaForBenchmark(result: BenchmarkResult, keys: (keyof T | "measuredRunsAvgMs" | "totalMs")[] = ["measuredRunsAvgMs"]) {
        const prevResults = this.data.history.filter(h => h.benchmarks[result.name]);
        const lastResult = prevResults.length > 0 ? prevResults[prevResults.length-1].benchmarks[result.name] : undefined;

        if(!lastResult) { // no previous result for this benchmark
            return false;
        }

        const currentResultExtras = this.options?.benchExtras && this.options.benchExtras(result);

        const calcDelta = (current: any, prev: any, key: any) => {
            const diff = current[key] - prev[key];
            const percDiff = diff / prev[key];

            return {
                percent: percDiff,
                amount: diff
            }
        }


        if(keys.length === 0) {
            keys = ["measuredRunsAvgMs"];
        }
        const deltas: {[key:string]: Delta} = {};

        keys.forEach(key => {
            if(key === "measuredRunsAvgMs" || key === "totalMs") {
                deltas[key as string] = calcDelta(result, lastResult, key);
            } else {
                if(!currentResultExtras || !currentResultExtras[key]){ 
                    throw new Error(`No property named "${key}" in calculated extras for currently measured benchmark named "${result.name}".`);
                }
    
                if(!lastResult.extras || !lastResult.extras[key]) { // TODO consider throwing
                    return false;
                }
    
                deltas[key as string] = calcDelta(currentResultExtras, lastResult.extras, key);
            }
        });

        return deltas;

    }

    getData() {
        // TODO deep copy
        return this.data;
    }

    getDataString() {
        return JSON.stringify(this.getData(), null, 2);
    }
}

function example() {

    bench({
        name: "historic",
        func(b) {
            b.start();
            for (let i = 0; i < 1e3; i++) {
                const NPeP = Math.random() === Math.random();
            }
            b.stop();
        },
        runs: 500
    });

    bench({
        name: "x3#14",
        func(b) {
            b.start();
            for (let i = 0; i < 1e5; i++) {
                const NPeP = Math.random() === Math.random();
            }
            b.stop();
        },
        runs: 1000
    });
    
    let prevString;
    try {
        prevString = JSON.parse(Deno.readTextFileSync('./benchmarks/historicx.json'));
    } catch {
        console.warn('⚠ cant read file');
    }

    const historic = new prettyBenchmarkHistory({ 
        saveIndividualRuns: false,
        minRequiredRuns: 100,
        onlyHrTime: true,
        strict: true,
        benchExtras: (r: BenchmarkResult) => ({r: r.name, ...calculateExtraMetrics(r), std: calculateStdDeviation(r)}),
        runExtras: (rr: BenchmarkRunResult) => ({dv: Deno.version, f: rr.filtered})
    }, prevString);

    // console.log(JSON.stringify(historic.getData()));

    const inds: BenchIndicator[] = [
        {benches: /historic/, modFn: _ => "👃"}
    ];

    runBenchmarks({silent: true}, prettyBenchmarkProgress({indicators: inds, nocolor: false}))
        // TODO defaultColumns to func, dont get avg, total, just name, maybe runs
        // .then(prettyBenchmarkDown(md => {Deno.writeTextFileSync("./benchmarks/hmdx.md", md)}, {columns: [{title: 'Name', propertyKey: 'name'}, ...historicRow(historic),{title: 'Average (ms)', propertyKey: 'measuredRunsAvgMs', toFixed: 4}, historicColumn(historic)]})) // historicColumn
        .then((results: BenchmarkRunResult) => {


            // console.log(historic.getDeltasFrom(results, "max"))
            console.log(historic.getDeltasFrom(results, ["max", "std", "nincs" as any]))
            historic.addResults(results);
            // console.log(historic.getDataString());
            
            // console.log(historic.getDeltasFrom(results));
            
            // Deno.writeTextFileSync("./benchmarks/historicx.json", historic.addResults(results).getDataString());
        });

    return;
}

// deno run --allow-read --allow-write --allow-hrtime .\pretty_benchmark_historic.ts

example();