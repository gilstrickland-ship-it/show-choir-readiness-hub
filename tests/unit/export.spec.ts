import { describe, test, expect } from "vitest";
import { csvCell, toCsv, csvFile } from "@/lib/export";

// CSV escaping is the load-bearing part of export-all (T029): a stray comma or
// quote in a memo must never shift columns or corrupt the file a burned Charms
// customer is trusting us to produce.

describe("csvCell", () => {
  test("passes plain values through", () => {
    expect(csvCell("Ava")).toBe("Ava");
    expect(csvCell(2027)).toBe("2027");
    expect(csvCell(0)).toBe("0");
  });

  test("empties null/undefined", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });

  test("quotes and doubles quotes for commas/quotes/newlines", () => {
    expect(csvCell("Lopez, Zoe")).toBe('"Lopez, Zoe"');
    expect(csvCell('He said "hi"')).toBe('"He said ""hi"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(csvCell("has\rcr")).toBe('"has\rcr"');
  });

  test("JSON-stringifies objects (sizes jsonb)", () => {
    expect(csvCell({ top: "M", pants: "32" })).toBe('"{""top"":""M"",""pants"":""32""}"');
  });
});

describe("toCsv", () => {
  test("builds header + rows with CRLF and a trailing newline", () => {
    const out = toCsv(["a", "b"], [
      [1, 2],
      ["x,y", "z"],
    ]);
    expect(out).toBe('a,b\r\n1,2\r\n"x,y",z\r\n');
  });

  test("empty rows still yields a header line", () => {
    expect(toCsv(["only"], [])).toBe("only\r\n");
  });
});

describe("csvFile", () => {
  test("wraps name + content", () => {
    const f = csvFile("students.csv", ["id"], [["s1"]]);
    expect(f.name).toBe("students.csv");
    expect(f.content).toBe("id\r\ns1\r\n");
  });
});
