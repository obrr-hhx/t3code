import { expect, it } from "vite-plus/test";
import { presentManagerContent } from "./recordPresentation";

it("keeps a goal readable when legacy authorization is truncated by pagination", () => {
  const content =
    'Release the fix.\n\nWaiting for healthy instances.\n\n{"source_ids":["receipt"],"actions":["dep';
  expect(presentManagerContent(content).text).toBe(
    "Release the fix.\n\nWaiting for healthy instances.",
  );
});
it("separates authorization from progress without hiding JSON examples in normal prose", () => {
  const value = presentManagerContent(
    'Progress.\n\n{"scope":"Only staging","exclusions":"No production","actions":["test"]}\n\n原始目标与全部证据保存在 /old/archive\n\n{"example":true}',
  );
  expect(value).toEqual({
    text: 'Progress.\n\n{"example":true}',
    scope: "Only staging",
    limits: "No production",
  });
});
