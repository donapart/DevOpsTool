import * as vscode from 'vscode';
import { AccountManager, AccountColorLabels } from '../core/accounts';
import { GitHubProvider, GitHubRepo, GitHubWorkflow, GitHubWorkflowRun } from '../providers/githubProvider';
import { logError } from '../util/logging';

export class GitHubTreeDataProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(
    private githubProvider: GitHubProvider,
    private accountManager: AccountManager
  ) {}

  refresh() {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    try {
      if (!element) {
        // Root level: Show accounts
        const accounts = this.githubProvider.getAccounts();
        
        if (accounts.length === 0) {
          return [new AddAccountItem()];
        }

        return accounts.map(account => new AccountTreeItem(account));
      }

      // Account level: Show repos
      if (element instanceof AccountTreeItem) {
        const allRepos = await this.githubProvider.listRepos();
        const accountRepos = allRepos.filter(r => r.accountId === element.account.id);
        
        if (accountRepos.length === 0) {
          return [new EmptyItem('Keine Repositories gefunden')];
        }

        return accountRepos.map(r => new RepoTreeItem(r));
      }

      // Repo level: Show workflows
      if (element instanceof RepoTreeItem) {
        try {
          const workflows = await this.githubProvider.listWorkflows(
            element.repo.fullName,
            element.repo.accountId
          );
          
          if (workflows.length === 0) {
            return [new EmptyItem('Keine Workflows gefunden')];
          }

          return workflows.map(w => new WorkflowTreeItem(w, element.repo));
        } catch (err) {
          return [new EmptyItem('Workflows nicht verfügbar')];
        }
      }

      // Workflow level: Show recent runs
      if (element instanceof WorkflowTreeItem) {
        try {
          const runs = await this.githubProvider.listWorkflowRuns(
            element.workflow.repoName,
            element.workflow.id,
            element.workflow.accountId
          );
          
          if (runs.length === 0) {
            return [new EmptyItem('Keine Runs gefunden')];
          }

          return runs.slice(0, 5).map(r => new WorkflowRunTreeItem(r));
        } catch (err) {
          return [new EmptyItem('Runs nicht verfügbar')];
        }
      }

      return [];
    } catch (err) {
      logError('GitHubTree', 'Failed to load tree data', err);
      return [new ErrorTreeItem(err)];
    }
  }
}

class AccountTreeItem extends vscode.TreeItem {
  constructor(public readonly account: { id: string; name: string; color: string; isDefault?: boolean }) {
    const colorEmoji = AccountColorLabels[account.color as keyof typeof AccountColorLabels]?.split(' ')[0] || '⚪';
    super(`${colorEmoji} ${account.name}${account.isDefault ? ' ⭐' : ''}`, vscode.TreeItemCollapsibleState.Expanded);
    
    this.contextValue = 'account';
    this.iconPath = new vscode.ThemeIcon('github');
    this.tooltip = `GitHub Account: ${account.name}`;
  }
}

class RepoTreeItem extends vscode.TreeItem {
  constructor(public readonly repo: GitHubRepo) {
    super(repo.name, vscode.TreeItemCollapsibleState.Collapsed);
    
    const visibility = repo.private ? '🔒' : '🌐';
    this.description = `${visibility} ${repo.language || 'No language'} · ⭐ ${repo.stargazersCount}`;
    
    this.iconPath = new vscode.ThemeIcon(
      repo.private ? 'lock' : 'repo',
      new vscode.ThemeColor(repo.private ? 'charts.orange' : 'charts.green')
    );
    
    this.tooltip = [
      `📦 ${repo.fullName}`,
      repo.description || 'Keine Beschreibung',
      '',
      `Branch: ${repo.defaultBranch}`,
      `Sprache: ${repo.language || 'Keine'}`,
      `⭐ ${repo.stargazersCount} Stars · 🍴 ${repo.forksCount} Forks`,
      `📝 ${repo.openIssuesCount} offene Issues`,
      '',
      `Letzter Push: ${new Date(repo.pushedAt).toLocaleDateString('de-DE')}`
    ].join('\n');
    
    this.contextValue = 'repo';
  }

  get repoId(): number { return this.repo.id; }
  get accountId(): string { return this.repo.accountId; }
}

class WorkflowTreeItem extends vscode.TreeItem {
  constructor(
    public readonly workflow: GitHubWorkflow,
    public readonly repo: GitHubRepo
  ) {
    super(workflow.name, vscode.TreeItemCollapsibleState.Collapsed);
    
    const stateIcon = workflow.state === 'active' ? '✅' : '⏸️';
    this.description = `${stateIcon} ${workflow.path}`;
    
    this.iconPath = new vscode.ThemeIcon(
      'github-action',
      new vscode.ThemeColor(workflow.state === 'active' ? 'charts.green' : 'charts.yellow')
    );
    
    this.tooltip = [
      `⚡ ${workflow.name}`,
      `Pfad: ${workflow.path}`,
      `Status: ${workflow.state}`,
      `Repo: ${workflow.repoName}`
    ].join('\n');
    
    this.contextValue = 'workflow';
  }

  get workflowId(): number { return this.workflow.id; }
  get accountId(): string { return this.workflow.accountId; }
  get repoFullName(): string { return this.workflow.repoName; }
  get defaultBranch(): string { return this.repo.defaultBranch; }
}

class WorkflowRunTreeItem extends vscode.TreeItem {
  constructor(public readonly run: GitHubWorkflowRun) {
    const statusEmoji = run.status === 'completed' 
      ? (run.conclusion === 'success' ? '✅' : run.conclusion === 'failure' ? '❌' : '⚪')
      : run.status === 'in_progress' ? '🔄' : '⏳';
    
    super(`${statusEmoji} ${run.name || 'Run'}`, vscode.TreeItemCollapsibleState.None);
    
    this.description = `${run.branch} · ${run.event}`;
    
    let iconColor: vscode.ThemeColor;
    if (run.status === 'completed') {
      iconColor = run.conclusion === 'success' 
        ? new vscode.ThemeColor('charts.green')
        : new vscode.ThemeColor('charts.red');
    } else if (run.status === 'in_progress') {
      iconColor = new vscode.ThemeColor('charts.yellow');
    } else {
      iconColor = new vscode.ThemeColor('disabledForeground');
    }
    
    this.iconPath = new vscode.ThemeIcon('play-circle', iconColor);
    
    this.tooltip = [
      `Run: ${run.name}`,
      `Status: ${run.status}`,
      run.conclusion ? `Ergebnis: ${run.conclusion}` : '',
      `Branch: ${run.branch}`,
      `Event: ${run.event}`,
      `Gestartet: ${new Date(run.createdAt).toLocaleString('de-DE')}`
    ].filter(Boolean).join('\n');
    
    this.contextValue = 'workflow-run';
    
    // Click to open in browser
    this.command = {
      command: 'vscode.open',
      title: 'Im Browser öffnen',
      arguments: [vscode.Uri.parse(run.htmlUrl)]
    };
  }

  get runId(): number { return this.run.id; }
}

class AddAccountItem extends vscode.TreeItem {
  constructor() {
    super('GitHub Account hinzufügen...', vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('add');
    this.command = {
      command: 'devops.addAccount',
      title: 'Account hinzufügen'
    };
  }
}

class EmptyItem extends vscode.TreeItem {
  constructor(message: string) {
    super(message, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('info');
  }
}

class ErrorTreeItem extends vscode.TreeItem {
  constructor(error: unknown) {
    const message = error instanceof Error ? error.message : 'Unbekannter Fehler';
    super(`❌ ${message}`, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('charts.red'));
  }
}

export { RepoTreeItem, WorkflowTreeItem, WorkflowRunTreeItem };

