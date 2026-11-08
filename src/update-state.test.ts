import { expect, it, vi } from "vitest";
import { UpdateState } from "../electron/main/update-state";

it("contains check failures, publishes a retry state without raw errors, and recovers on retry", async () => {
  const changed = vi.fn(), log = vi.fn();
  const state = new UpdateState(changed, log, vi.fn(async () => {}));
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

it("prevents duplicate checks and keeps the spinner active through the download", async () => {
  const state = new UpdateState(vi.fn(), vi.fn(), vi.fn(async () => {}));
  let finish!: () => void;
  const pending = state.check(async () => {
    state.available("1.2.3");
    await new Promise<void>(resolve => { finish = resolve; });
    void state.downloaded("1.2.3");
  });
  const duplicate = vi.fn(async () => {});
  await state.check(duplicate);
  expect(duplicate).not.toHaveBeenCalled();
  expect(state.status()).toMatchObject({ checking: true, availableVersion: "1.2.3", downloaded: false });
  finish();
  await pending;
  expect(state.status()).toMatchObject({ checking: false, availableVersion: "1.2.3", downloaded: true });
});

it("reports download failures and starts the next check without a stale download status", async () => {
  const showInstallDialog = vi.fn(async () => {});
  const state = new UpdateState(vi.fn(), vi.fn(), showInstallDialog);
  await state.check(async () => {
    state.available("1.2.3");
    throw new Error("download interrupted");
  });
  expect(state.status()).toMatchObject({ checking: false, failed: true, availableVersion: "1.2.3", downloaded: false });
  expect(showInstallDialog).not.toHaveBeenCalled();
  await state.check(async () => {});
  expect(state.status()).toEqual({ checking: false, failed: false, availableVersion: null, downloaded: false });
});

it("automatically offers a completed download and allows reopening the dialog after Later", async () => {
  const showInstallDialog = vi.fn(async (_version: string) => {});
  const state = new UpdateState(vi.fn(), vi.fn(), showInstallDialog);
  state.available("1.2.3");
  await state.promptToInstall();
  expect(showInstallDialog).not.toHaveBeenCalled();

  let dismiss!: () => void;
  showInstallDialog.mockImplementationOnce(() => new Promise<void>(resolve => { dismiss = resolve; }));
  const prompt = state.downloaded("1.2.3");
  expect(showInstallDialog).toHaveBeenCalledExactlyOnceWith("1.2.3");
  await state.promptToInstall();
  const check = vi.fn(async () => {});
  await state.check(check);
  expect(check).not.toHaveBeenCalled();
  expect(showInstallDialog).toHaveBeenCalledOnce();
  dismiss();
  await prompt;
  expect(state.status()).toMatchObject({ availableVersion: "1.2.3", downloaded: true });

  await state.promptToInstall();
  expect(showInstallDialog).toHaveBeenCalledTimes(2);
  await state.check(async () => {});
  state.available("1.2.3");
  await state.downloaded("1.2.3");
  expect(showInstallDialog).toHaveBeenCalledTimes(2);
  expect(state.status().downloaded).toBe(true);

  state.available("1.2.4");
  expect(state.status().downloaded).toBe(false);
  await state.downloaded("1.2.4");
  expect(showInstallDialog).toHaveBeenCalledTimes(3);
  expect(showInstallDialog).toHaveBeenLastCalledWith("1.2.4");
});
