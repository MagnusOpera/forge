import { expect, it, vi } from "vitest";
import { showUpgradeDialog } from "../electron/main/upgrade-dialog";

function actions(...responses: number[]) {
  return {
    showDialog: vi.fn(async () => ({ response: responses.shift()!, checkboxChecked: false })),
    download: vi.fn(async () => {}),
    install: vi.fn(),
  };
}

it("allows dismissing a ready upgrade and reopening it later", async () => {
  const flow = actions(1, 0);
  await showUpgradeDialog("1.2.3", true, flow);
  expect(flow.install).not.toHaveBeenCalled();
  expect(flow.download).not.toHaveBeenCalled();
  expect(flow.showDialog).toHaveBeenCalledWith(expect.objectContaining({
    buttons: ["Restart and Install", "Later"], cancelId: 1,
  }));
  await showUpgradeDialog("1.2.3", true, flow);
  expect(flow.install).toHaveBeenCalledOnce();
});

it("allows dismissing an upgrade before the download is ready", async () => {
  const flow = actions(1);
  await showUpgradeDialog("1.2.3", false, flow);
  expect(flow.showDialog).toHaveBeenCalledOnce();
  expect(flow.download).not.toHaveBeenCalled();
  expect(flow.install).not.toHaveBeenCalled();
});

it("waits for an accepted download and allows dismissing the restart confirmation", async () => {
  const flow = actions(0, 1);
  let finish!: () => void;
  flow.download.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  const pending = showUpgradeDialog("1.2.3", false, flow);
  await Promise.resolve();
  expect(flow.download).toHaveBeenCalledOnce();
  expect(flow.showDialog).toHaveBeenCalledOnce();
  expect(flow.install).not.toHaveBeenCalled();
  finish();
  await pending;
  expect(flow.showDialog).toHaveBeenCalledTimes(2);
  expect(flow.install).not.toHaveBeenCalled();
});

it("installs after explicitly accepting both prompts", async () => {
  const flow = actions(0, 0);
  await showUpgradeDialog("1.2.3", false, flow);
  expect(flow.install).toHaveBeenCalledOnce();
});

it("does not offer a restart or install when downloading fails", async () => {
  const flow = actions(0);
  flow.download.mockRejectedValue(new Error("offline"));
  await expect(showUpgradeDialog("1.2.3", false, flow)).rejects.toThrow("offline");
  expect(flow.showDialog).toHaveBeenCalledOnce();
  expect(flow.install).not.toHaveBeenCalled();
});
