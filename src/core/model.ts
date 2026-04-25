const MANAGED_PREFIX = "s_";
const LEGACY_MANAGED_PREFIX = "seiton__";

export type Branch = {
  name: string;
  id?: string;
};

export type RegistryContext = {
  id: string;
  projectRoot: string;
  branch: string;
  branchKey: string;
  branchId?: string;
  pendingBranch?: string;
  tmuxSession: string;
  kittyTabTitle: string;
  order: number;
  createdAt: string;
  updatedAt: string;
};

export type RegistryProject = {
  root: string;
  name: string;
  projectKey: string;
  order: number;
  enabled: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type Registry = {
  projects?: RegistryProject[];
  contexts: RegistryContext[];
};

export type KittyTab = {
  id: number;
  title: string;
  osWindowId: number;
  index: number;
};

export type ContextStatus =
  | "ready"
  | "missing_tmux"
  | "missing_kitty"
  | "orphan_tmux"
  | "order_drift"
  | "rename_pending"
  | "rename_conflict"
  | "error";

export type CodexPaneStatus = "running" | "idle";

export type CodexPane = {
  paneId: string;
  command: string;
  lastLine: string;
  status: CodexPaneStatus;
};

export type Context = {
  id: string;
  type: "managed";
  projectRoot: string;
  branch: string;
  branchKey: string;
  branchId?: string;
  tmuxSession: string;
  kittyTabTitle: string;
  primaryPaneId?: string;
  codexPanes: CodexPane[];
  order: number;
  status: ContextStatus;
};

export type SyncInput = {
  projectRoot: string;
  branches: Branch[];
  tmuxSessions: string[];
  kittyTabs: KittyTab[];
  codexPanesBySession: Record<string, CodexPane[]>;
  registry: Registry;
};

export type SyncCommand =
  | {
      type: "create_tmux_session";
      branch: string;
      tmuxSession: string;
    }
  | {
      type: "create_kitty_tab";
      branch: string;
      kittyTabTitle: string;
      tmuxSession: string;
    }
  | {
      type: "rename_tmux_session";
      oldSession: string;
      newSession: string;
    }
  | {
      type: "rename_kitty_tab";
      oldTitle: string;
      newTitle: string;
    }
  | {
      type: "move_kitty_tab_backward";
      kittyTabTitle: string;
    }
  | {
      type: "move_kitty_tab_forward";
      kittyTabTitle: string;
    };

export type SyncPlan = {
  contexts: Context[];
  commands: SyncCommand[];
  registryUpdates: RegistryContext[];
  warnings: string[];
};

export type ReconcileRegistryInput = {
  projectRoot: string;
  branches: Branch[];
  registry: Registry;
  now: string;
};

export type EnsureProjectInput = {
  registry: Registry;
  root: string;
  now: string;
};

export function buildBranchKey(branch: string): string {
  return strictEncode(branch);
}

export function buildProjectKey(root: string): string {
  return strictEncode(normalizeProjectRoot(root));
}

export function decodeBranchKey(branchKey: string): string {
  return decodeURIComponent(branchKey);
}

export function buildManagedName(projectRoot: string, branch: string): string {
  return `${MANAGED_PREFIX}${buildProjectSlug(projectRoot)}_${buildBranchKey(branch)}`;
}

export function buildProjectSlug(projectRoot: string): string {
  const normalizedRoot = normalizeProjectRoot(projectRoot);
  const name = normalizedRoot.split("/").filter(Boolean).at(-1) ?? normalizedRoot;
  const spaced = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
  const parts = spaced
    .split(/[^A-Za-z0-9]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return "x";
  if (parts.length === 1) return parts[0]!.toLowerCase();
  return parts.map((part) => part[0]?.toLowerCase() ?? "").join("");
}

export function ensureProject(input: EnsureProjectInput): Registry {
  const normalizedRoot = normalizeProjectRoot(input.root);
  const projects = [...(input.registry.projects ?? [])];
  const existing = projects.find((project) => project.root === normalizedRoot);
  if (existing) {
    return {
      ...input.registry,
      projects: projects.map((project) =>
        project.root === normalizedRoot
          ? { ...project, enabled: true, updatedAt: input.now }
          : project
      )
    };
  }

  const name = normalizedRoot.split("/").filter(Boolean).at(-1) ?? normalizedRoot;
  projects.push({
    root: normalizedRoot,
    name,
    projectKey: buildProjectKey(normalizedRoot),
    order: nextProjectOrder(projects),
    enabled: true,
    createdAt: input.now,
    updatedAt: input.now
  });

  return { ...input.registry, projects };
}

export function isManagedName(name: string): boolean {
  return name.startsWith(MANAGED_PREFIX) || name.startsWith(LEGACY_MANAGED_PREFIX);
}

export function branchFromManagedName(name: string): string {
  if (name.startsWith(LEGACY_MANAGED_PREFIX)) {
    const rest = name.slice(LEGACY_MANAGED_PREFIX.length);
    const separator = rest.indexOf("__");
    if (separator === -1) return decodeBranchKey(rest);
    return decodeBranchKey(rest.slice(separator + 2));
  }
  const rest = name.slice(MANAGED_PREFIX.length);
  const separator = rest.indexOf("_");
  if (separator === -1) return decodeBranchKey(rest);
  return decodeBranchKey(rest.slice(separator + 1));
}

export function projectKeyFromManagedName(name: string): string | undefined {
  if (name.startsWith(LEGACY_MANAGED_PREFIX)) {
    return undefined;
  }
  const rest = name.slice(MANAGED_PREFIX.length);
  const separator = rest.indexOf("_");
  if (separator === -1) return undefined;
  return rest.slice(0, separator);
}

export type ProjectContexts = {
  project: RegistryProject;
  contexts: Context[];
};

export function detectAllContexts(
  registry: Registry,
  snapshot: {
    projects: Record<string, { branches: Branch[]; warnings: string[] }>;
    tmuxSessions: string[];
    kittyTabs: KittyTab[];
    codexPanesBySession: Record<string, CodexPane[]>;
  }
): ProjectContexts[] {
  const projects = registry.projects ?? [];
  return projects
    .sort((a, b) => a.order - b.order)
    .map((project) => {
      const projectSnapshot = snapshot.projects[project.root];
      if (!projectSnapshot) {
        return { project, contexts: [] };
      }
      const contexts = detectContexts({
        projectRoot: project.root,
        branches: projectSnapshot.branches,
        tmuxSessions: snapshot.tmuxSessions,
        kittyTabs: snapshot.kittyTabs,
        codexPanesBySession: snapshot.codexPanesBySession,
        registry
      });
      return { project, contexts };
    });
}

export function detectContexts(input: SyncInput): Context[] {
  const scopedRegistry = scopeRegistry(input.registry, input.projectRoot);
  const contexts = input.branches.map((branch) => {
    const existing = findRegistryContext(scopedRegistry, branch);
    const branchKey = buildBranchKey(branch.name);
    const tmuxSession = buildManagedName(input.projectRoot, branch.name);
    const kittyTabTitle = tmuxSession;
    const hasTmux = input.tmuxSessions.includes(tmuxSession);
    const hasKitty = input.kittyTabs.some((tab) => tab.title === kittyTabTitle);

    const context: Context = {
      id: existing?.id ?? `branch:${branch.name}`,
      type: "managed" as const,
      projectRoot: input.projectRoot,
      branch: branch.name,
      branchKey,
      tmuxSession,
      kittyTabTitle,
      codexPanes: input.codexPanesBySession[tmuxSession] ?? [],
      order: existing?.order ?? nextOrder(scopedRegistry),
      status: statusForPresence(hasTmux, hasKitty)
    };
    if (branch.id) context.branchId = branch.id;
    return context;
  });

  const branchNames = new Set(input.branches.map((branch) => branch.name));
  for (const session of input.tmuxSessions) {
    if (!isManagedName(session)) continue;
    const projectKey = projectKeyFromManagedName(session);
    if (projectKey && projectKey !== buildProjectSlug(input.projectRoot)) continue;
    const branch = branchFromManagedName(session);
    if (branchNames.has(branch)) continue;
    const existing = scopedRegistry.contexts.find(
      (context) => context.tmuxSession === session
    );
    const orphan: Context = {
      id: existing?.id ?? `orphan:${session}`,
      type: "managed",
      projectRoot: input.projectRoot,
      branch,
      branchKey: buildBranchKey(branch),
      tmuxSession: session,
      kittyTabTitle: session,
      codexPanes: input.codexPanesBySession[session] ?? [],
      order: existing?.order ?? Number.MAX_SAFE_INTEGER,
      status: "orphan_tmux"
    };
    if (existing?.branchId) orphan.branchId = existing.branchId;
    contexts.push(orphan);
  }

  return contexts.sort((a, b) => a.order - b.order || a.branch.localeCompare(b.branch));
}

export function planSync(input: SyncInput): SyncPlan {
  const commands: SyncCommand[] = [];
  const warnings: string[] = [];
  const registryUpdates: RegistryContext[] = [];

  const scopedRegistry = scopeRegistry(input.registry, input.projectRoot);

  for (const context of scopedRegistry.contexts) {
    const branch = resolveBranchForRegistryContext(context, input.branches);
    if (!branch) continue;

    const targetBranch = branch.name;
    const targetName = buildManagedName(input.projectRoot, targetBranch);

    if (context.pendingBranch && context.pendingBranch !== targetBranch) {
      warnings.push(
        `GitButler branch name overrides pending Electron rename for ${context.branch}.`
      );
    }

    if (context.tmuxSession !== targetName && input.tmuxSessions.includes(context.tmuxSession)) {
      commands.push({
        type: "rename_tmux_session",
        oldSession: context.tmuxSession,
        newSession: targetName
      });
    }

    if (
      context.kittyTabTitle !== targetName &&
      input.kittyTabs.some((tab) => tab.title === context.kittyTabTitle)
    ) {
      commands.push({
        type: "rename_kitty_tab",
        oldTitle: context.kittyTabTitle,
        newTitle: targetName
      });
    }

    if (context.branch !== targetBranch || context.pendingBranch) {
      const update: RegistryContext = {
        ...context,
        branch: targetBranch,
        branchKey: buildBranchKey(targetBranch),
        tmuxSession: targetName,
        kittyTabTitle: targetName
      };
      delete update.pendingBranch;
      registryUpdates.push(update);
    }
  }

  const contexts = detectContexts(input);
  for (const context of contexts) {
    if (context.status === "orphan_tmux") continue;
    const hasTmux = input.tmuxSessions.includes(context.tmuxSession);
    const hasKitty = input.kittyTabs.some(
      (tab) => tab.title === context.kittyTabTitle
    );

    if (!hasTmux) {
      commands.push({
        type: "create_tmux_session",
        branch: context.branch,
        tmuxSession: context.tmuxSession
      });
    }

    if (!hasKitty) {
      commands.push({
        type: "create_kitty_tab",
        branch: context.branch,
        kittyTabTitle: context.kittyTabTitle,
        tmuxSession: context.tmuxSession
      });
    }
  }

  const orderPlan = planKittyOrderMoves(input);
  commands.push(...orderPlan.commands);
  warnings.push(...orderPlan.warnings);

  return { contexts, commands, registryUpdates, warnings };
}

export function reconcileRegistry(input: ReconcileRegistryInput): Registry {
  const registryWithProject = ensureProject({
    registry: input.registry,
    root: input.projectRoot,
    now: input.now
  });
  const scoped = scopeRegistry(input.registry, input.projectRoot);
  const nextContexts = [...registryWithProject.contexts];

  for (const branch of input.branches) {
    const existing = findRegistryContext(scoped, branch);
    if (existing) continue;

    const branchKey = buildBranchKey(branch.name);
    const context: RegistryContext = {
      id: `${input.projectRoot}:${branch.name}`,
      projectRoot: input.projectRoot,
      branch: branch.name,
      branchKey,
      tmuxSession: buildManagedName(input.projectRoot, branch.name),
      kittyTabTitle: buildManagedName(input.projectRoot, branch.name),
      order: nextOrder({ contexts: nextContexts.filter((candidate) => candidate.projectRoot === input.projectRoot) }),
      createdAt: input.now,
      updatedAt: input.now
    };
    if (branch.id) context.branchId = branch.id;
    nextContexts.push(context);
  }

  return { ...registryWithProject, contexts: nextContexts };
}

export function planKittyOrderMoves(input: SyncInput): {
  commands: SyncCommand[];
  warnings: string[];
} {
  const managedTabs = input.kittyTabs
    .filter((tab) => isManagedName(tab.title))
    .sort((a, b) => a.index - b.index);

  if (managedTabs.length < 2) {
    return { commands: [], warnings: [] };
  }

  const osWindowIds = new Set(managedTabs.map((tab) => tab.osWindowId));
  if (osWindowIds.size > 1) {
    return {
      commands: [],
      warnings: ["Managed Kitty tabs are split across OS windows; order sync skipped."]
    };
  }

  const allTabsInWindow = input.kittyTabs
    .filter((tab) => tab.osWindowId === managedTabs[0]?.osWindowId)
    .sort((a, b) => a.index - b.index);
  const managedIndexes = managedTabs.map((tab) =>
    allTabsInWindow.findIndex((candidate) => candidate.id === tab.id)
  );
  const min = Math.min(...managedIndexes);
  const max = Math.max(...managedIndexes);
  const block = allTabsInWindow.slice(min, max + 1);
  if (block.some((tab) => !isManagedName(tab.title))) {
    return {
      commands: [],
      warnings: [
        "Managed Kitty tabs are separated by unmanaged tabs; order sync skipped."
      ]
    };
  }

  const expected = expectedManagedNames(
    input.branches,
    scopeRegistry(input.registry, input.projectRoot)
  );
  const current = managedTabs.map((tab) => tab.title);
  const commands: SyncCommand[] = [];
  const working = [...current];

  for (let expectedIndex = 0; expectedIndex < expected.length; expectedIndex += 1) {
    const target = expected[expectedIndex];
    if (!target) continue;
    let currentIndex = working.indexOf(target);
    if (currentIndex === -1) continue;

    while (currentIndex > expectedIndex) {
      commands.push({ type: "move_kitty_tab_backward", kittyTabTitle: target });
      [working[currentIndex - 1], working[currentIndex]] = [
        working[currentIndex] as string,
        working[currentIndex - 1] as string
      ];
      currentIndex -= 1;
    }

    while (currentIndex < expectedIndex) {
      commands.push({ type: "move_kitty_tab_forward", kittyTabTitle: target });
      [working[currentIndex], working[currentIndex + 1]] = [
        working[currentIndex + 1] as string,
        working[currentIndex] as string
      ];
      currentIndex += 1;
    }
  }

  return { commands, warnings: [] };
}

function statusForPresence(hasTmux: boolean, hasKitty: boolean): ContextStatus {
  if (hasTmux && hasKitty) return "ready";
  if (!hasTmux) return "missing_tmux";
  return "missing_kitty";
}

function findRegistryContext(
  registry: Registry,
  branch: Branch
): RegistryContext | undefined {
  if (branch.id) {
    const byId = registry.contexts.find((context) => context.branchId === branch.id);
    if (byId) return byId;
  }
  return registry.contexts.find((context) => context.branch === branch.name);
}

function resolveBranchForRegistryContext(
  context: RegistryContext,
  branches: Branch[]
): Branch | undefined {
  if (context.branchId) {
    const byId = branches.find((branch) => branch.id === context.branchId);
    if (byId) return byId;
  }
  return branches.find((branch) => branch.name === context.branch);
}

function nextOrder(registry: Registry): number {
  const max = Math.max(0, ...registry.contexts.map((context) => context.order));
  return max + 10;
}

function nextProjectOrder(projects: RegistryProject[]): number {
  const max = Math.max(0, ...projects.map((project) => project.order));
  return max + 10;
}

function normalizeProjectRoot(root: string): string {
  return root.replace(/\/+$/, "") || "/";
}

function strictEncode(value: string): string {
  return encodeURIComponent(value).replace(/\./g, "%2E");
}

function scopeRegistry(registry: Registry, projectRoot: string): Registry {
  const scoped: Registry = {
    contexts: registry.contexts.filter(
      (context) => context.projectRoot === projectRoot
    )
  };
  if (registry.projects) scoped.projects = registry.projects;
  return scoped;
}

function expectedManagedNames(branches: Branch[], registry: Registry): string[] {
  const branchNames = new Set(branches.map((branch) => branch.name));
  return registry.contexts
    .filter((context) => branchNames.has(context.branch))
    .sort((a, b) => a.order - b.order || a.branch.localeCompare(b.branch))
    .map((context) => buildManagedName(context.projectRoot, context.branch));
}
