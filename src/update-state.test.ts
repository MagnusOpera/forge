import { expect, it, vi } from "vitest";
import { UpdateState } from "../electron/main/update-state";

it("contains check failures, publishes a retry state without raw errors, and recovers on retry", async () => {
  const changed = vi.fn(), log = vi.fn();
  const state = new UpdateState(changed, log);
  const failure = new Error("404 latest-mac.yml: response headers and stack trace");
  await expect(state.check(async () => { throw failure; })).resolves.toBeUndefined();
  expect(log).toHaveBeenCalledWith(failure);
  expect(changed.mock.calls.map(([status]) => status)).toEqual([
    { checking: true, failed: false, availableVersion: null, downloaded: false },
    { checking: true, failed: true, availableVersion: null, downloaded: false },
    { checking: false, failed: true, availableVersion: null, downloaded: false },
  ]);
  await state.check(async () => {});
  expect(state.status()).toEqual({ checking: false, failed: false, availableVersion: null, downloaded: false });
});

it("prevents duplicate checks and keeps the spinner until the active check settles", async () => {
  const state = new UpdateState(vi.fn(), vi.fn());
  let finish!: () => void;
  const pending = state.check(() => new Promise<void>(resolve => { finish = resolve; }));
  const duplicate = vi.fn(async () => {});
  await state.check(duplicate);
  expect(duplicate).not.toHaveBeenCalled();
  expect(state.status().checking).toBe(true);
  finish();
  await pending;
  expect(state.status().checking).toBe(false);
});

it("reports background download failures and restores upgrade readiness after recovery", async () => {
  const state = new UpdateState(vi.fn(), vi.fn());
  state.available("1.2.3");
  state.fail(new Error("download interrupted"));
  expect(state.status()).toMatchObject({ failed: true, availableVersion: "1.2.3", downloaded: false });
  await state.check(async () => state.available("1.2.3"));
  expect(state.status()).toMatchObject({ failed: false, checking: false });
  state.downloaded("1.2.3");
  expect(state.status()).toMatchObject({ failed: false, downloaded: true });
  state.available("1.2.3");
  expect(state.status().downloaded).toBe(true);
  state.available("1.2.4");
  expect(state.status().downloaded).toBe(false);
});
