import test from "node:test";
import assert from "node:assert/strict";

import {
  parseCliArgs,
  resolveSortOptions,
  runSortResults,
  sortPublications,
  timestamp,
} from "../../src/pipeline/sort-results.mjs";


  test("sortPublications: relevance returns original order", () => {
    const pubs = [{ year: 2020, citedBy: 10 }, { year: 2022, citedBy: 5 }];
    assert.deepEqual(sortPublications(pubs, "relevance", undefined), pubs);
  });

  test("sortPublications: date newest sorts descending by year", () => {
    const pubs = [{ year: 2019, citedBy: 0 }, { year: 2023, citedBy: 0 }, { year: 2021, citedBy: 0 }];
    const sorted = sortPublications(pubs, "date", "newest");
    assert.deepEqual(sorted.map(p => p.year), [2023, 2021, 2019]);
  });

  test("sortPublications: date oldest sorts ascending by year", () => {
    const pubs = [{ year: 2023 }, { year: 2019 }, { year: 2021 }];
    assert.deepEqual(sortPublications(pubs, "date", "oldest").map(p => p.year), [2019, 2021, 2023]);
  });

  test("sortPublications: citedBy highest sorts descending", () => {
    const pubs = [{ citedBy: 3 }, { citedBy: 100 }, { citedBy: 0 }];
    assert.deepEqual(sortPublications(pubs, "citedBy", "highest").map(p => p.citedBy), [100, 3, 0]);
  });

  test("sortPublications: citedBy lowest sorts ascending", () => {
    const pubs = [{ citedBy: 3 }, { citedBy: 100 }, { citedBy: 0 }];
    assert.deepEqual(sortPublications(pubs, "citedBy", "lowest").map(p => p.citedBy), [0, 3, 100]);
  });

  test("sortPublications: missing values treated as 0", () => {
    const pubs = [{ title: "a" }, { citedBy: 5, title: "b" }, { citedBy: 0, title: "c" }];
    const sorted = sortPublications(pubs, "citedBy", "highest");
    assert.equal(sorted[0].title, "b");
  });

  test("sortPublications: does not mutate original array", () => {
    const pubs = [{ year: 2022 }, { year: 2018 }];
    sortPublications(pubs, "date", "newest");
    assert.equal(pubs[0].year, 2022);
  });

  test("resolveSortOptions: preset cited-highest returns correct options", () => {
    const opts = resolveSortOptions({ preset: "cited-highest" });
    assert.equal(opts.sortBy, "citedBy");
    assert.equal(opts.sortDirection, "highest");
    assert.equal(opts.label, "cited-highest");
  });

  test("resolveSortOptions: preset date-oldest returns correct options", () => {
    const opts = resolveSortOptions({ preset: "date-oldest" });
    assert.equal(opts.sortBy, "date");
    assert.equal(opts.sortDirection, "oldest");
  });

  test("resolveSortOptions: rejects unknown preset", () => {
    assert.throws(() => resolveSortOptions({ preset: "nope" }), /preset inválido/);
  });

	  test("resolveSortOptions: sortBy=date with direction oldest maps correctly", () => {
	    const opts = resolveSortOptions({ sortBy: "date", sortDirection: "oldest" });
	    assert.equal(opts.sortBy, "date");
	    assert.equal(opts.sortDirection, "oldest");
	    assert.equal(opts.label, "date-oldest");
	  });

	  test("resolveSortOptions: accepts lowercase sortby/sortdirection aliases", () => {
	    const opts = resolveSortOptions({ sortby: "YEAR", sortdirection: "ASC" });
	    assert.deepEqual(opts, { sortBy: "date", sortDirection: "oldest", label: "date-oldest" });
	  });

	  test("resolveSortOptions: defaults date and citedBy directions when direction is omitted", () => {
	    assert.deepEqual(
	      resolveSortOptions({ sortBy: "date" }),
	      { sortBy: "date", sortDirection: "newest", label: "date-newest" }
	    );
	    assert.deepEqual(
	      resolveSortOptions({ sortBy: "cited" }),
	      { sortBy: "citedBy", sortDirection: "highest", label: "cited-highest" }
	    );
	  });

	  test("resolveSortOptions: maps citedBy ascending directions to lowest", () => {
	    for (const dir of ["lowest", "asc", "ascending"]) {
	      assert.deepEqual(
	        resolveSortOptions({ sortBy: "citedBy", sortDirection: dir }),
	        { sortBy: "citedBy", sortDirection: "lowest", label: "cited-lowest" }
	      );
	    }
	  });

	  test("resolveSortOptions: supports relevance sortBy", () => {
	    assert.deepEqual(resolveSortOptions({ sortBy: "relevance" }), { sortBy: "relevance", label: "relevance" });
	  });

	  test("resolveSortOptions: rejects invalid sortBy", () => {
	    assert.throws(() => resolveSortOptions({ sortBy: "title" }), /sortBy inválido/);
	  });

	  test("resolveSortOptions: throws when neither preset nor sortBy provided", () => {
	    assert.throws(() => resolveSortOptions({}), /Informe --preset ou --sortBy/);
	  });

	  test("parseCliArgs: parses inline, separated, boolean and ignored tokens", () => {
	    assert.deepEqual(
	      parseCliArgs(["noise", "--preset=cited-highest", "--sortBy", "date", "--flag", "--", "--empty="]),
	      {
	        preset: "cited-highest",
	        sortBy: "date",
	        flag: true,
	        empty: ""
	      }
	    );
	  });

	  test("parseCliArgs: ignores blank option names", () => {
	    assert.deepEqual(parseCliArgs(["--", "--sortDirection", "oldest"]), { sortDirection: "oldest" });
	  });

	  test("timestamp: formats date using zero-padded local components", () => {
	    assert.equal(timestamp(new Date(2024, 0, 2, 3, 4, 5)), "2024-01-02_03h04m05s");
	  });

	  test("runSortResults: sorts latest collect links and appends jsonl rows", () => {
	    const appended = [];
	    const info = [];
	    const dividers = [];
	    const collectFile = "/tmp/links-collect.json";
	    const paths = {
	      collectDir: "/collect",
	      outputDir: "/output",
	      sortedDir: "/sorted"
	    };
	    const findCalls = [];

	    runSortResults({
	      argv: ["--preset", "date-newest"],
	      paths,
	      findLatest(dir) {
	        findCalls.push(dir);
	        return dir === paths.collectDir ? collectFile : null;
	      },
	      read(file, fallback) {
	        assert.equal(file, collectFile);
	        assert.deepEqual(fallback, []);
	        return [
	          {
	            name: "search-a",
	            publications: [
	              { title: "old", year: 2020 },
	              { title: "new", year: 2024 }
	            ]
	          },
	          { name: "empty-search" }
	        ];
	      },
	      append(file, pub) {
	        appended.push({ file, pub });
	      },
	      logger: {
	        info(message) { info.push(message); },
	        error(message) { assert.fail(`unexpected error: ${message}`); },
	        divider() { dividers.push(true); }
	      },
	      now: () => new Date(2024, 4, 6, 7, 8, 9)
	    });

	    assert.deepEqual(findCalls, [paths.collectDir]);
	    assert.deepEqual(appended.map(item => item.pub.title), ["new", "old"]);
	    assert.ok(appended.every(item => item.file === "/sorted/date-newest/search-a-2024-05-06_07h08m09s.jsonl"));
	    assert.equal(dividers.length, 1);
	    assert.ok(info.some(message => message.includes("Ordenação: date-newest")));
	  });

	  test("runSortResults: falls back to output links when collect has none", () => {
	    const calls = [];
	    const appended = [];

	    runSortResults({
	      argv: ["--preset=relevance"],
	      paths: { collectDir: "/collect", outputDir: "/output", sortedDir: "/sorted" },
	      findLatest(dir) {
	        calls.push(dir);
	        return dir === "/output" ? "/output/links.json" : null;
	      },
	      read() {
	        return [{ name: "search-b", publications: [{ title: "first" }] }];
	      },
	      append(file, pub) {
	        appended.push({ file, pub });
	      },
	      logger: { info() {}, error() {}, divider() {} },
	      now: () => new Date(2024, 0, 1, 0, 0, 0)
	    });

	    assert.deepEqual(calls, ["/collect", "/output"]);
	    assert.equal(appended[0].file, "/sorted/relevance/search-b-2024-01-01_00h00m00s.jsonl");
	    assert.equal(appended[0].pub.title, "first");
	  });

	  test("runSortResults: exits when no links file is found", () => {
	    const errors = [];

	    assert.throws(() => runSortResults({
	      argv: ["--preset", "cited-highest"],
	      paths: { collectDir: "/collect", outputDir: "/output", sortedDir: "/sorted" },
	      findLatest() { return null; },
	      logger: { info() {}, error(message) { errors.push(message); }, divider() {} },
	      exit(code) { throw new Error(`exit:${code}`); }
	    }), /exit:1/);

	    assert.match(errors[0], /Nenhum arquivo links-\*\.json encontrado/);
	  });

	  test("runSortResults: exits when links file is empty", () => {
	    const errors = [];

	    assert.throws(() => runSortResults({
	      argv: ["--preset", "date-oldest"],
	      paths: { collectDir: "/collect", outputDir: "/output", sortedDir: "/sorted" },
	      findLatest() { return "/collect/links.json"; },
	      read() { return []; },
	      logger: { info() {}, error(message) { errors.push(message); }, divider() {} },
	      exit(code) { throw new Error(`exit:${code}`); }
	    }), /exit:1/);

	    assert.deepEqual(errors, ["Arquivo de links vazio."]);
	  });
