const MANAGED_PREFIX = "s_";
const LEGACY_MANAGED_PREFIX = "seiton__";

export type Branch = {
  name: string;
  id?: string;
};

export type TerminalBackendName = "kitty" | "wezterm";

export type RegistrySettings = {
  terminalBackend: TerminalBackendName;
};

export type RegistryContext = {
  id: string;
  projectRoot: string;
  branch: string;
  branchKey: string;
  branchId?: string;
  pendingBranch?: string;
  tmuxSession: string;
  terminalTabTitle: string;
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
  settings?: RegistrySettings;
  projects?: RegistryProject[];
  contexts: RegistryContext[];
};

export type TerminalTab = {
  id: number;
  title: string;
  osWindowId: number;
  index: number;
};

export type ContextStatus =
  | "ready"
  | "missing_tmux"
  | "missing_terminal"
  | "orphan_tmux"
  | "order_drift"
  | "rename_pending"
  | "rename_conflict"
  | "error";

export type AgentName = "codex" | "claude";

export type AgentPaneStatus = "running" | "idle" | "waiting" | "error";

export type AgentPane = {
  agent: AgentName;
  paneId: string;
  command: string;
  lastLine: string;
  status: AgentPaneStatus;
};

export type CodexPaneStatus = AgentPaneStatus;

export type CodexPane = AgentPane;

export type Context = {
  id: string;
  type: "managed";
  projectRoot: string;
  branch: string;
  branchKey: string;
  branchId?: string;
  tmuxSession: string;
  terminalTabTitle: string;
  primaryPaneId?: string;
  agentPanes: AgentPane[];
  order: number;
  status: ContextStatus;
};

export type WorkspaceSessionStatus =
  | "ready"
  | "missing_tmux"
  | "missing_terminal";

export type WorkspaceSession = {
  type: "workspace";
  projectRoot: string;
  name: string;
  terminalTabTitle: string;
  primaryPaneId?: string;
  agentPanes: AgentPane[];
  status: WorkspaceSessionStatus;
};

export type SyncInput = {
  projectRoot: string;
  branches: Branch[];
  tmuxSessions: string[];
  terminalTabs?: TerminalTab[];
  kittyTabs?: TerminalTab[];
  agentPanesBySession: Record<string, AgentPane[]>;
  registry: Registry;
};

export type SyncCommand =
  | {
      type: "create_tmux_session";
      branch: string;
      tmuxSession: string;
    }
  | {
      type: "create_terminal_tab";
      branch: string;
      terminalTabTitle: string;
      tmuxSession: string;
    }
  | {
      type: "rename_tmux_session";
      oldSession: string;
      newSession: string;
    }
  | {
      type: "rename_terminal_tab";
      oldTitle: string;
      newTitle: string;
    }
  | {
      type: "move_terminal_tab_backward";
      terminalTabTitle: string;
    }
  | {
      type: "move_terminal_tab_forward";
      terminalTabTitle: string;
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

export type RemoveProjectInput = {
  registry: Registry;
  root: string;
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

export function buildWorkspaceSessionName(projectRoot: string): string {
  const normalizedRoot = normalizeProjectRoot(projectRoot);
  return normalizedRoot.split("/").filter(Boolean).at(-1) ?? normalizedRoot;
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
  if (!isPersistableProjectRoot(normalizedRoot)) {
    return input.registry;
  }
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

export function removeProject(input: RemoveProjectInput): Registry {
  const normalizedRoot = normalizeProjectRoot(input.root);
  return {
    ...input.registry,
    projects: (input.registry.projects ?? []).filter((project) => project.root !== normalizedRoot),
    contexts: input.registry.contexts.filter((context) => context.projectRoot !== normalizedRoot)
  };
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
  workspaceSession: WorkspaceSession | undefined;
  contexts: Context[];
  warnings?: string[];
};

export function detectAllContexts(
  registry: Registry,
  snapshot: {
    projects: Record<string, { branches: Branch[]; warnings: string[] }>;
    tmuxSessions: string[];
    terminalTabs?: TerminalTab[];
    kittyTabs?: TerminalTab[];
    agentPanesBySession: Record<string, AgentPane[]>;
  }
): ProjectContexts[] {
  const projects = registry.projects ?? [];
  return projects
    .sort((a, b) => a.order - b.order)
    .map((project) => {
      const projectSnapshot = snapshot.projects[project.root];
      if (!projectSnapshot) {
        return { project, workspaceSession: undefined, contexts: [], warnings: [] };
      }
      const contexts = detectContexts({
        projectRoot: project.root,
        branches: projectSnapshot.branches,
        tmuxSessions: snapshot.tmuxSessions,
        terminalTabs: readTerminalTabs(snapshot),
        agentPanesBySession: snapshot.agentPanesBySession,
        registry
      });
      return {
        project,
        workspaceSession: detectWorkspaceSession({
          projectRoot: project.root,
          tmuxSessions: snapshot.tmuxSessions,
          terminalTabs: readTerminalTabs(snapshot),
          agentPanesBySession: snapshot.agentPanesBySession
        }),
        contexts,
        warnings: projectSnapshot.warnings
      };
    });
}

export function detectContexts(input: SyncInput): Context[] {
  const terminalTabs = readTerminalTabs(input);
  const scopedRegistry = scopeRegistry(input.registry, input.projectRoot);
  const contexts = input.branches.map((branch) => {
    const existing = findRegistryContext(scopedRegistry, branch);
    const branchKey = buildBranchKey(branch.name);
    const tmuxSession = buildManagedName(input.projectRoot, branch.name);
    const terminalTabTitle = tmuxSession;
    const hasTmux = input.tmuxSessions.includes(tmuxSession);
    const hasTerminal = terminalTabs.some((tab) => tab.title === terminalTabTitle);

    const context: Context = {
      id: existing?.id ?? `branch:${branch.name}`,
      type: "managed" as const,
      projectRoot: input.projectRoot,
      branch: branch.name,
      branchKey,
      tmuxSession,
      terminalTabTitle,
      agentPanes: input.agentPanesBySession[tmuxSession] ?? [],
      order: existing?.order ?? nextOrder(scopedRegistry),
      status: statusForPresence(hasTmux, hasTerminal)
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
      terminalTabTitle: session,
      agentPanes: input.agentPanesBySession[session] ?? [],
      order: existing?.order ?? Number.MAX_SAFE_INTEGER,
      status: "orphan_tmux"
    };
    if (existing?.branchId) orphan.branchId = existing.branchId;
    contexts.push(orphan);
  }

  return contexts.sort((a, b) => a.order - b.order || a.branch.localeCompare(b.branch));
}

export function planSync(input: SyncInput): SyncPlan {
  const terminalTabs = readTerminalTabs(input);
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
      context.terminalTabTitle !== targetName &&
      terminalTabs.some((tab) => tab.title === readContextTerminalTabTitle(context))
    ) {
      commands.push({
        type: "rename_terminal_tab",
        oldTitle: readContextTerminalTabTitle(context),
        newTitle: targetName
      });
    }

    if (context.branch !== targetBranch || context.pendingBranch) {
      const update: RegistryContext = {
        ...context,
        branch: targetBranch,
        branchKey: buildBranchKey(targetBranch),
        tmuxSession: targetName,
        terminalTabTitle: targetName
      };
      delete update.pendingBranch;
      registryUpdates.push(update);
    }
  }

  const contexts = detectContexts(input);
  for (const context of contexts) {
    if (context.status === "orphan_tmux") continue;
    const hasTmux = input.tmuxSessions.includes(context.tmuxSession);
    const hasTerminal = terminalTabs.some(
      (tab) => tab.title === context.terminalTabTitle
    );

    if (!hasTmux) {
      commands.push({
        type: "create_tmux_session",
        branch: context.branch,
        tmuxSession: context.tmuxSession
      });
    }

    if (!hasTerminal) {
      commands.push({
        type: "create_terminal_tab",
        branch: context.branch,
        terminalTabTitle: context.terminalTabTitle,
        tmuxSession: context.tmuxSession
      });
    }
  }

  const orderPlan = planTerminalOrderMoves(input);
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
      terminalTabTitle: buildManagedName(input.projectRoot, branch.name),
      order: nextOrder({ contexts: nextContexts.filter((candidate) => candidate.projectRoot === input.projectRoot) }),
      createdAt: input.now,
      updatedAt: input.now
    };
    if (branch.id) context.branchId = branch.id;
    nextContexts.push(context);
  }

  return { ...registryWithProject, contexts: nextContexts };
}

export function planTerminalOrderMoves(input: SyncInput): {
  commands: SyncCommand[];
  warnings: string[];
} {
  const terminalTabs = readTerminalTabs(input);
  const managedTabs = terminalTabs
    .filter((tab) => isManagedName(tab.title))
    .sort((a, b) => a.index - b.index);

  if (managedTabs.length < 2) {
    return { commands: [], warnings: [] };
  }

  const osWindowIds = new Set(managedTabs.map((tab) => tab.osWindowId));
  if (osWindowIds.size > 1) {
    return {
      commands: [],
      warnings: ["Managed terminal tabs are split across OS windows; order sync skipped."]
    };
  }

  const allTabsInWindow = terminalTabs
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
        "Managed terminal tabs are separated by unmanaged tabs; order sync skipped."
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
      commands.push({ type: "move_terminal_tab_backward", terminalTabTitle: target });
      [working[currentIndex - 1], working[currentIndex]] = [
        working[currentIndex] as string,
        working[currentIndex - 1] as string
      ];
      currentIndex -= 1;
    }

    while (currentIndex < expectedIndex) {
      commands.push({ type: "move_terminal_tab_forward", terminalTabTitle: target });
      [working[currentIndex], working[currentIndex + 1]] = [
        working[currentIndex + 1] as string,
        working[currentIndex] as string
      ];
      currentIndex += 1;
    }
  }

  return { commands, warnings: [] };
}

export const planKittyOrderMoves = planTerminalOrderMoves;
export type KittyTab = TerminalTab;

function statusForPresence(hasTmux: boolean, hasKitty: boolean): ContextStatus {
  if (hasTmux && hasKitty) return "ready";
  if (!hasTmux) return "missing_tmux";
  return "missing_terminal";
}

function workspaceStatusForPresence(
  hasTmux: boolean,
  hasKitty: boolean
): WorkspaceSessionStatus {
  if (hasTmux && hasKitty) return "ready";
  if (!hasTmux) return "missing_tmux";
  return "missing_terminal";
}

function detectWorkspaceSession(input: {
  projectRoot: string;
  tmuxSessions: string[];
  terminalTabs?: TerminalTab[];
  kittyTabs?: TerminalTab[];
  agentPanesBySession: Record<string, AgentPane[]>;
}): WorkspaceSession | undefined {
  const terminalTabs = readTerminalTabs(input);
  const name = buildWorkspaceSessionName(input.projectRoot);
  const hasTmux = input.tmuxSessions.includes(name);
  const hasTerminal = terminalTabs.some((tab) => tab.title === name);
  if (!hasTmux && !hasTerminal) return undefined;
  return {
    type: "workspace",
    projectRoot: input.projectRoot,
    name,
    terminalTabTitle: name,
    agentPanes: input.agentPanesBySession[name] ?? [],
    status: workspaceStatusForPresence(hasTmux, hasTerminal)
  };
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

export function isPersistableProjectRoot(root: string): boolean {
  return normalizeProjectRoot(root) !== "/";
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

function readTerminalTabs(input: { terminalTabs?: TerminalTab[]; kittyTabs?: TerminalTab[] }): TerminalTab[] {
  return input.terminalTabs ?? input.kittyTabs ?? [];
}

function readContextTerminalTabTitle(
  context: RegistryContext & { kittyTabTitle?: string }
): string {
  return context.terminalTabTitle ?? context.kittyTabTitle ?? context.tmuxSession;
}
