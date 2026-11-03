import type { MessageBoxOptions, MessageBoxReturnValue } from "electron";

type UpgradeDialogActions = {
  showDialog(options: MessageBoxOptions): Promise<MessageBoxReturnValue>;
  download(): Promise<unknown>;
  install(): void;
};

export async function showUpgradeDialog(version: string, downloaded: boolean, actions: UpgradeDialogActions): Promise<void> {
  if (!downloaded) {
    const result = await actions.showDialog({
      type: "info",
      buttons: ["Download and Install", "Later"],
      defaultId: 0,
      cancelId: 1,
      title: "Update Available",
      message: `Forge ${version} is available.`,
      detail: "Finish downloading the update, then confirm restarting Forge to install it.",
    });
    if (result.response !== 0) return;
    await actions.download();
  }

  const result = await actions.showDialog({
    type: "info",
    buttons: ["Restart and Install", "Later"],
    defaultId: 0,
    cancelId: 1,
    title: "Update Ready",
    message: `Forge ${version} is ready to install.`,
    detail: "Restart Forge to finish installing the update.",
  });
  if (result.response === 0) actions.install();
}
