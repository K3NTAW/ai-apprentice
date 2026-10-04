// PendingButton: disabled with aria-busy while its transition runs, enabled again after.
// useTransition is replaced by a controllable fake so the node test can step through the transition.
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

const t = vi.hoisted(() => ({ pending: false, run: null as null | (() => unknown) }));
vi.mock("react", async (orig) => ({
  ...(await orig<typeof import("react")>()),
  useTransition: () => [
    t.pending,
    (fn: () => unknown) => {
      t.pending = true;
      t.run = fn;
    },
  ],
}));

import PendingButton from "./PendingButton";

type Props = { disabled: boolean; "aria-busy": boolean; onClick: () => void; children: unknown };
const render = (onAction: () => Promise<void>) =>
  (PendingButton({ onAction, children: "Build", pendingLabel: "Building…" }) as ReactElement<Props>).props;

describe("PendingButton", () => {
  it("is disabled and aria-busy while its transition runs", async () => {
    let resolve!: () => void;
    const onAction = vi.fn(() => new Promise<void>((r) => (resolve = r)));
    const idle = render(onAction);
    expect(idle).toMatchObject({ disabled: false, "aria-busy": false, children: "Build" });
    idle.onClick();
    expect(render(onAction)).toMatchObject({ disabled: true, "aria-busy": true, children: "Building…" });
    const done = Promise.resolve(t.run!());
    expect(onAction).toHaveBeenCalledTimes(1);
    resolve();
    await done;
    t.pending = false;
    expect(render(onAction)).toMatchObject({ disabled: false, "aria-busy": false });
  });
});
