import { Tag } from "lucide-react";
import type { ReleaseSummary } from "../shared/github";
import { releaseDate, releasesForTab, type ReleaseTab } from "../shared/releases";
import { useSlidingUnderline } from "./useSlidingUnderline";

export function ReleasesSection(props: {
  releases: ReleaseSummary[];
  tab: ReleaseTab;
  selectedId?: string;
  onTab(tab: ReleaseTab): void;
  onSelect(release: ReleaseSummary): void;
}) {
  "use no memo"; // Preserve the live ref handling at this imperative UI boundary.

  const underline = useSlidingUnderline(`${props.tab}:${props.releases.length}`);
  const visible = releasesForTab(props.releases, props.tab);
  const labels = { active: "Active", preview: "Preview", draft: "Draft" };
  const empty = { active: "No active releases", preview: "No preview releases", draft: "No draft releases" };
  return <div className="pull-request-focus">
    <div ref={underline.containerRef} className="pull-request-tabs" role="tablist" aria-label="Release view">
      {(["active", "preview", "draft"] as const).map(tab => <button key={tab}
        className={`pull-request-tab${props.tab === tab ? " active" : ""}`}
        role="tab" aria-selected={props.tab === tab}
        data-active-tab={props.tab === tab ? "true" : undefined}
        onClick={() => props.onTab(tab)}>
        {labels[tab]}
        <span>{releasesForTab(props.releases, tab).length}</span>
      </button>)}
      <span className="sliding-tab-underline" style={underline.underlineStyle} aria-hidden="true" />
    </div>
    <div className="focus-section">
      <div className="section-title"><Tag size={15} /><span>{labels[props.tab]} Releases</span><span className="count">{visible.length}</span></div>
      {visible.length ? visible.map(release => <button key={release.id}
        className={`focus-row${props.selectedId === release.id ? " active" : ""}`}
        onClick={() => props.onSelect(release)}>
        <Tag size={15} />
        <span className="focus-main">
          <span className="focus-title">{release.name || release.tagName}</span>
          <span className="focus-meta">{release.tagName}{release.isPrerelease ? " · Pre-release" : release.isLatest ? " · Latest" : ""} · {new Date(releaseDate(release)).toLocaleDateString()}</span>
        </span>
      </button>) : <div className="empty-row">{empty[props.tab]}</div>}
    </div>
  </div>;
}
