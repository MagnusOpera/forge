import type { MessageBoxOptions, MessageBoxReturnValue } from "electron";

type UpgradeDialogActions = {
  showDialog(options: MessageBoxOptions): Promise<MessageBoxReturnValue>;
  install(): void;
};

export async function showUpgradeDialog(version: string, actions: UpgradeDialogActions): Promise<void> {
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
