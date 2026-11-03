import type { AppUpdateStatus } from "../../shared/github.js";

export class UpdateState {
  private value: AppUpdateStatus = { checking: false, failed: false, availableVersion: null, downloaded: false };

  constructor(
    private readonly changed: (status: AppUpdateStatus) => void,
    private readonly logError: (error: unknown) => void,
  ) {}

  status(): AppUpdateStatus { return { ...this.value }; }

  private publish(patch: Partial<AppUpdateStatus>): void {
    this.value = { ...this.value, ...patch };
    this.changed(this.status());
  }

  available(version: string): void {
    this.publish({ availableVersion: version, downloaded: this.value.availableVersion === version && this.value.downloaded });
  }

  downloaded(version: string): void {
    this.publish({ availableVersion: version, downloaded: true, failed: false });
  }

  fail(error: unknown): void {
    this.logError(error);
    this.publish({ failed: true });
  }

  async check(action: () => Promise<unknown>): Promise<void> {
    if (this.value.checking) return;
    this.publish({ checking: true, failed: false });
    try {
      await action();
    } catch (error) {
      this.fail(error);
    } finally {
      this.publish({ checking: false });
    }
  }
}
