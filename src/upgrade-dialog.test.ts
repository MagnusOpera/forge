import { expect, it, vi } from "vitest";
import { showUpgradeDialog } from "../electron/main/upgrade-dialog";

function actions(...responses: number[]) {
  return {
    showDialog: vi.fn(async () => ({ response: responses.shift()!, checkboxChecked: false })),
    install: vi.fn(),
  };
}

it("allows dismissing a ready upgrade and reopening it later", async () => {
  const flow = actions(1, 0);
  await showUpgradeDialog("1.2.3", flow);
  expect(flow.install).not.toHaveBeenCalled();
  expect(flow.showDialog).toHaveBeenCalledOnce();
  expect(flow.showDialog).toHaveBeenCalledWith(expect.objectContaining({
    buttons: ["Restart and Install", "Later"], cancelId: 1,
    message: "Forge 1.2.3 is ready to install.",
  }));
  await showUpgradeDialog("1.2.3", flow);
  expect(flow.install).toHaveBeenCalledOnce();
});

it("waits for the restart confirmation before installing", async () => {
  const flow = actions();
  let finish!: () => void;
  flow.showDialog.mockImplementation(() => new Promise(resolve => {
    finish = () => resolve({ response: 0, checkboxChecked: false });
  }));
  const pending = showUpgradeDialog("1.2.3", flow);
  expect(flow.showDialog).toHaveBeenCalledOnce();
  expect(flow.install).not.toHaveBeenCalled();
  finish();
  await pending;
  expect(flow.install).toHaveBeenCalledOnce();
});
