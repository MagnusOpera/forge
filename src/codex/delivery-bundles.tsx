import { useRef, useState } from "react";
import { Package, Pencil, Plus, Trash2 } from "lucide-react";
import { filterRepositories } from "../appLogic";
import { RepoButton, RepositorySelector } from "../components/repository-selector";
import type { RepoSummary } from "../../shared/github";
import { resolveBundleRepositories, validateBundle, type ProjectBundle } from "./delivery";

type BundleForm = { id?: string; name: string; repositories: RepoSummary[] };

export function DeliveryBundles({
  bundles, selectedId, repositories, loading, onSelect, onSave, onRemove,
}: {
  bundles: ProjectBundle[];
  selectedId?: string;
  repositories: RepoSummary[];
  loading: boolean;
  onSelect: (id: string) => void;
  onSave: (bundle: ProjectBundle) => void;
  onRemove: (bundle: ProjectBundle) => void;
}) {
  const [form, setForm] = useState<BundleForm | null>(null);
  const [query, setQuery] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [error, setError] = useState("");
  const newButton = useRef<HTMLButtonElement>(null);

  function openEditor(bundle?: ProjectBundle) {
    setForm({
      id: bundle?.id,
      name: bundle?.name ?? "",
      repositories: resolveBundleRepositories(bundle, repositories),
    });
    setQuery("");
    setCollapsedGroups({});
    setError("");
  }

  function closeEditor() {
    setForm(null);
    requestAnimationFrame(() => newButton.current?.focus());
  }

  const choices = new Map(repositories.map((repo) => [repo.id, repo]));
  for (const repo of form?.repositories ?? []) {
    if (!choices.has(repo.id)) choices.set(repo.id, repo);
  }
  const visibleRepos = form ? filterRepositories([...choices.values()], query) : [];

  return (
    <section className="delivery-bundles" aria-label="Project bundles">
      <div className="section-title delivery-list-heading">
        <h2><Package size={15} /> {form ? (form.id ? "Edit bundle" : "New bundle") : "Project bundles"}</h2>
        {!form && (
          <>
            <span className="count">{bundles.length}</span>
            <button ref={newButton} type="button" className="icon-button" aria-label="New bundle" title="New bundle"
              onClick={() => openEditor()}>
              <Plus size={16} />
            </button>
          </>
        )}
      </div>
      {form && (
        <form className="delivery-bundle-form" aria-label={form.id ? "Edit bundle" : "Create bundle"}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              closeEditor();
            }
          }}
          onSubmit={(event) => {
            event.preventDefault();
            const issue = validateBundle(form.name, form.repositories, bundles, form.id);
            if (issue) {
              setError(issue);
              return;
            }
            onSave({ id: form.id ?? crypto.randomUUID(), name: form.name.trim(), repositories: form.repositories });
            closeEditor();
          }}>
          <label className="search-box">
            <input key={form.id ?? "new"} autoFocus required maxLength={100} value={form.name}
              aria-label="Bundle name" placeholder="Bundle name"
              onChange={(event) => { setForm({ ...form, name: event.target.value }); setError(""); }} />
          </label>
          <RepositorySelector
            repositories={visibleRepos}
            search={query}
            onSearch={setQuery}
            searchLabel="Search repositories for bundle"
            loading={loading}
            selectedCount={form.repositories.length}
            collapsedGroups={collapsedGroups}
            onToggleGroup={(owner) => setCollapsedGroups((current) => ({ ...current, [owner]: current[owner] !== true }))}
            renderRepository={(repo) => {
              const selected = form.repositories.some((member) => member.id === repo.id);
              return (
                <RepoButton key={repo.id} repo={repo} selected={selected} onSelect={() => {
                  const members = selected
                    ? form.repositories.filter((member) => member.id !== repo.id)
                    : [...form.repositories, repo];
                  setForm({ ...form, repositories: members });
                  setError("");
                }} />
              );
            }}
            footer={
              <>
                {error && <p className="inline-error" role="alert">{error}</p>}
                <div className="delivery-bundle-actions">
                  <button type="button" className="ghost-button" onClick={closeEditor}>Cancel</button>
                  <button type="submit" className="ghost-button">{form.id ? "Save bundle" : "Create bundle"}</button>
                </div>
              </>
            }
          />
        </form>
      )}
      {!form && (
        <>
          {!bundles.length && <p className="delivery-hint">Create a bundle to track Codex work across repositories.</p>}
          <ul className="sidebar-scroll delivery-rows">
            {bundles.map((bundle) => {
              const selected = bundle.id === selectedId;
              const count = bundle.repositories.length;
              return (
                <li key={bundle.id} className={`repo-button-wrap delivery-bundle-row${selected ? " selected" : ""}`}>
                  <button type="button" className="repo-button" aria-current={selected ? "true" : undefined}
                    onClick={() => onSelect(bundle.id)}>
                    <strong className="repo-name" title={bundle.name}>{bundle.name}</strong>
                    <span className="repo-meta" title={`${count} ${count === 1 ? "repository" : "repositories"}`}>{count}</span>
                  </button>
                  <button type="button" className="icon-button" aria-label={`Edit ${bundle.name}`} title="Edit bundle"
                    onClick={() => openEditor(bundle)}><Pencil size={13} /></button>
                  <button type="button" className="icon-button" aria-label={`Delete ${bundle.name}`} title="Delete bundle"
                    onClick={() => onRemove(bundle)}><Trash2 size={13} /></button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
