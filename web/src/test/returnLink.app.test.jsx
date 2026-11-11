// Opened from Customer Agent LAB: the strip and the header Back button show; nothing is preselected.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { returnLinkFor } from "../return-link/returnTargets.js";
import App from "../App.jsx";

// The same fetch stub as App.test.jsx: this app's api module calls fetch, so the tests stub fetch.
const json = (data, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => data });
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    if (url === "/api/config") return json({ pfBase: "https://pf.example:9031", ownClientIdConfigured: false, clientDev: { clientId: "https://client.dev/oauth/metadata.json" } });
    return json({ ok: true });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, "", "/"); });

const NOTE = { name: "Opened from Customer Agent LAB" };

describe("return link", () => {
  it("the vendored files match return-link.sha256, which names the parent commit", () => {
    const dir = path.join(process.cwd(), "src", "return-link");
    const text = fs.readFileSync(path.join(dir, "return-link.sha256"), "utf8");
    expect(text.split("\n")[0]).toMatch(/^# vendored byte for byte from curtismu7\/AI-DEMO-Standalone shared\/return-link at [0-9a-f]{7,40}/);
    const pins = text.split("\n").filter((l) => l && !l.startsWith("#")).map((l) => l.split(/\s+/));
    expect(pins.map(([, f]) => f).sort()).toEqual(["ReturnLink.jsx", "ReturnLink.test.jsx", "returnTargets.js"]);
    for (const [h, f] of pins) expect(createHash("sha256").update(fs.readFileSync(path.join(dir, f))).digest("hex"), f).toBe(h);
  });

  it("?from=customer-agent: banner first, strip right below, header Back in the tools", async () => {
    window.history.replaceState(null, "", "/?from=customer-agent&uc=UC43&vertical=banking");
    render(<App />);
    const note = await screen.findByRole("note", NOTE);
    await screen.findByRole("heading", { name: "What CIMD is" });
    expect(note.textContent).toContain("UC43");
    expect(document.querySelector(".banner").nextElementSibling).toBe(note);
    expect(document.querySelector(".shell-bar .shell-right > button.return-link--header")).not.toBeNull();
    expect(screen.getAllByRole("button", { name: /Back to Customer Agent LAB/ })).toHaveLength(2);
  });

  it("no from, an unknown from or a bad id: no strip, no button", async () => {
    for (const q of ["/", "/?from=elsewhere&uc=UC43", "/?from=customer-agent&uc=%3Cb%3E", "/?from=customer-agent&uc=UC43&vertical=a%20b"]) {
      window.history.replaceState(null, "", q);
      render(<App />);
      await screen.findByRole("heading", { name: "What CIMD is" });
      expect(screen.queryByRole("button", { name: /Back to/ })).toBeNull();
      expect(screen.queryByRole("note", NOTE)).toBeNull();
      cleanup();
    }
  });

  it("Back goes to the proxy path behind the lab proxy, to the direct URL on the app's own port", () => {
    window.history.replaceState(null, "", "/cimd-lab/?from=customer-agent&uc=UC43");
    expect(returnLinkFor("cimd").href).toBe("/customer-agent/?returned=cimd&uc=UC43");
    window.history.replaceState(null, "", "/?from=customer-agent&uc=UC43");
    expect(returnLinkFor("cimd").href).toBe("http://127.0.0.1:5603/?returned=cimd&uc=UC43");
  });
});
