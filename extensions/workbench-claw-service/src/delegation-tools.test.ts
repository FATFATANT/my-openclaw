import { describe, expect, it } from "vitest";
import { parseWorkbenchResultText } from "./delegation-tools.js";

describe("parseWorkbenchResultText", () => {
  it("keeps a direct workbench response object", () => {
    expect(
      parseWorkbenchResultText('{"schema":"workbench.response.v1","type":"interaction"}'),
    ).toEqual({
      schema: "workbench.response.v1",
      type: "interaction",
    });
  });

  it("extracts the structured payload when a model adds prose", () => {
    expect(
      parseWorkbenchResultText(
        '已查询。\n```json\n{"schema":"workbench.response.v1","type":"interaction","interaction":{"kind":"report-selection"}}\n```',
      ),
    ).toMatchObject({
      type: "interaction",
      interaction: { kind: "report-selection" },
    });
  });
});
