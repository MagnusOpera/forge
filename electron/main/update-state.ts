import type { AppUpdateStatus } from "../../shared/github.js";

export class UpdateState {
  private value: AppUpdateStatus = { checking: false, failed: false, availableVersion: null, downloaded: false };
  private installDialogOpen = false;

  constructor(
    private readonly changed: (status: AppUpdateStatus) => void,
    private readonly logError: (error: unknown) => void,
    private readonly showInstallDialog: (version: string) => Promise<void>,
  ) {}

  status(): AppUpdateStatus { return { ...this.value }; }

  private publish(patch: Partial<AppUpdateStatus>): void {
    this.value = { ...this.value, ...patch };
    this.changed(this.status());
  }

  available(version: string): void {
    this.publish({ availableVersion: version, downloaded: this.value.availableVersion === version && this.value.downloaded });
  }

  async downloaded(version: string): Promise<void> {
    const newlyReady = !this.value.downloaded || this.value.availableVersion !== version;
    this.publish({ availableVersion: version, downloaded: true, failed: false });
    if (newlyReady) await this.promptToInstall();
  }

  async promptToInstall(): Promise<void> {
    const { availableVersion, downloaded } = this.value;
    if (!availableVersion || !downloaded || this.installDialogOpen) return;
    this.installDialogOpen = true;
    try {
      await this.showInstallDialog(availableVersion);
    } catch (error) {
      this.fail(error);
    } finally {
      this.installDialogOpen = false;
    }
  }

  fail(error: unknown): void {
    this.logError(error);
    this.publish({ failed: true });
  }

  async check(action: () => Promise<unknown>): Promise<void> {
    if (this.value.checking || this.installDialogOpen) return;
    this.publish({
      checking: true,
      failed: false,
      availableVersion: this.value.downloaded ? this.value.availableVersion : null,
    });
    try {
      await action();
    } catch (error) {
      this.fail(error);
    } finally {
      this.publish({ checking: false });
    }
  }
}
