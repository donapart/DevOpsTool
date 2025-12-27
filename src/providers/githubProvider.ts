import * as vscode from 'vscode';
import { AccountManager, Account, AccountColorMap } from '../core/accounts';
import { SimpleCache } from '../util/cache';
import { logDebug, logInfo, logError } from '../util/logging';
import { AuthError, ApiError, isAuthError } from '../util/errors';

const TAG = 'GitHub';

export interface GitHubRepo {
  id: number;
  name: string;
  fullName: string;
  description: string | null;
  private: boolean;
  htmlUrl: string;
  cloneUrl: string;
  sshUrl: string;
  defaultBranch: string;
  language: string | null;
  stargazersCount: number;
  forksCount: number;
  openIssuesCount: number;
  createdAt: string;
  updatedAt: string;
  pushedAt: string;
  accountId: string;
  accountName: string;
  accountColor: string;
}

export interface GitHubWorkflow {
  id: number;
  name: string;
  path: string;
  state: 'active' | 'disabled_manually' | 'disabled_inactivity';
  createdAt: string;
  updatedAt: string;
  repoId: number;
  repoName: string;
  accountId: string;
  accountName: string;
}

export interface GitHubWorkflowRun {
  id: number;
  name: string;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion: 'success' | 'failure' | 'cancelled' | 'skipped' | 'timed_out' | 'action_required' | null;
  workflowId: number;
  htmlUrl: string;
  branch: string;
  event: string;
  createdAt: string;
  updatedAt: string;
  repoName: string;
  accountId: string;
}

export class GitHubProvider {
  readonly id = 'github';
  readonly label = 'GitHub';
  readonly type = 'git' as const;

  private repoCache = new SimpleCache<GitHubRepo[]>(60000);
  private workflowCache = new SimpleCache<GitHubWorkflow[]>(30000);
  private runCache = new SimpleCache<GitHubWorkflowRun[]>(15000);

  constructor(
    private accountManager: AccountManager,
    private secrets: vscode.SecretStorage
  ) {}

  async isConfigured(): Promise<boolean> {
    return this.accountManager.hasAccountsForProvider('github');
  }

  invalidateCache(): void {
    this.repoCache.clear();
    this.workflowCache.clear();
    this.runCache.clear();
  }

  getAccounts(): Account[] {
    return this.accountManager.getByProvider('github');
  }

  // =============================================
  // REPOSITORIES
  // =============================================
  async listRepos(): Promise<GitHubRepo[]> {
    const accounts = this.getAccounts();
    
    if (accounts.length === 0) {
      return [];
    }

    return this.repoCache.getOrFetch('all-repos', async () => {
      const allRepos: GitHubRepo[] = [];

      for (const account of accounts) {
        try {
          const token = await this.accountManager.getToken(account.id);
          if (!token) continue;

          const repos = await this.fetchReposForAccount(account, token);
          allRepos.push(...repos);
        } catch (err) {
          logError(TAG, `Failed to fetch repos for account ${account.name}`, err);
        }
      }

      return allRepos;
    });
  }

  private async fetchReposForAccount(account: Account, token: string): Promise<GitHubRepo[]> {
    logInfo(TAG, `Fetching repositories for account: ${account.name}`);

    const response = await fetch('https://api.github.com/user/repos?per_page=100&sort=updated', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    });

    if (!response.ok) {
      if (isAuthError(response.status)) {
        throw new AuthError('GitHub');
      }
      throw new ApiError('GitHub', response.status, response.statusText);
    }

    const data: any[] = await response.json();
    const repos = data.map((r: any) => ({
      id: r.id,
      name: r.name,
      fullName: r.full_name,
      description: r.description,
      private: r.private,
      htmlUrl: r.html_url,
      cloneUrl: r.clone_url,
      sshUrl: r.ssh_url,
      defaultBranch: r.default_branch,
      language: r.language,
      stargazersCount: r.stargazers_count,
      forksCount: r.forks_count,
      openIssuesCount: r.open_issues_count,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      pushedAt: r.pushed_at,
      accountId: account.id,
      accountName: account.name,
      accountColor: AccountColorMap[account.color]
    }));

    logInfo(TAG, `Loaded ${repos.length} repositories for ${account.name}`);
    return repos;
  }

  // =============================================
  // WORKFLOWS (GitHub Actions)
  // =============================================
  async listWorkflows(repoFullName: string, accountId: string): Promise<GitHubWorkflow[]> {
    const cacheKey = `workflows-${repoFullName}`;
    
    return this.workflowCache.getOrFetch(cacheKey, async () => {
      const account = this.accountManager.getById(accountId);
      if (!account) throw new Error('Account nicht gefunden');

      const token = await this.accountManager.getToken(accountId);
      if (!token) throw new AuthError('GitHub');

      logInfo(TAG, `Fetching workflows for repo: ${repoFullName}`);

      const response = await fetch(`https://api.github.com/repos/${repoFullName}/actions/workflows`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28'
        }
      });

      if (!response.ok) {
        if (isAuthError(response.status)) {
          throw new AuthError('GitHub');
        }
        throw new ApiError('GitHub', response.status, response.statusText);
      }

      const data: any = await response.json();
      const workflows = (data.workflows || []).map((w: any) => ({
        id: w.id,
        name: w.name,
        path: w.path,
        state: w.state,
        createdAt: w.created_at,
        updatedAt: w.updated_at,
        repoId: 0, // Will be set by caller
        repoName: repoFullName,
        accountId: account.id,
        accountName: account.name
      }));

      logInfo(TAG, `Loaded ${workflows.length} workflows for ${repoFullName}`);
      return workflows;
    });
  }

  async listWorkflowRuns(repoFullName: string, workflowId: number, accountId: string): Promise<GitHubWorkflowRun[]> {
    const cacheKey = `runs-${repoFullName}-${workflowId}`;
    
    return this.runCache.getOrFetch(cacheKey, async () => {
      const account = this.accountManager.getById(accountId);
      if (!account) throw new Error('Account nicht gefunden');

      const token = await this.accountManager.getToken(accountId);
      if (!token) throw new AuthError('GitHub');

      logInfo(TAG, `Fetching workflow runs for workflow: ${workflowId}`);

      const response = await fetch(
        `https://api.github.com/repos/${repoFullName}/actions/workflows/${workflowId}/runs?per_page=10`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28'
          }
        }
      );

      if (!response.ok) {
        if (isAuthError(response.status)) {
          throw new AuthError('GitHub');
        }
        throw new ApiError('GitHub', response.status, response.statusText);
      }

      const data: any = await response.json();
      const runs = (data.workflow_runs || []).map((r: any) => ({
        id: r.id,
        name: r.name,
        status: r.status,
        conclusion: r.conclusion,
        workflowId: workflowId,
        htmlUrl: r.html_url,
        branch: r.head_branch,
        event: r.event,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        repoName: repoFullName,
        accountId: account.id
      }));

      logInfo(TAG, `Loaded ${runs.length} runs for workflow ${workflowId}`);
      return runs;
    });
  }

  async triggerWorkflow(repoFullName: string, workflowId: number, ref: string, accountId: string): Promise<void> {
    const account = this.accountManager.getById(accountId);
    if (!account) throw new Error('Account nicht gefunden');

    const token = await this.accountManager.getToken(accountId);
    if (!token) throw new AuthError('GitHub');

    logInfo(TAG, `Triggering workflow ${workflowId} on ${ref}`);

    const response = await fetch(
      `https://api.github.com/repos/${repoFullName}/actions/workflows/${workflowId}/dispatches`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28'
        },
        body: JSON.stringify({ ref })
      }
    );

    if (!response.ok) {
      const err = await response.text();
      throw new ApiError('GitHub', response.status, response.statusText, err);
    }

    this.runCache.clear();
    logInfo(TAG, `Workflow ${workflowId} triggered successfully`);
  }

  // =============================================
  // HELPER: Open in browser
  // =============================================
  async openInBrowser(url: string): Promise<void> {
    await vscode.env.openExternal(vscode.Uri.parse(url));
  }

  async cloneRepo(repo: GitHubRepo): Promise<void> {
    const uri = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: 'Clone hierhin'
    });

    if (uri && uri[0]) {
      const terminal = vscode.window.createTerminal('Git Clone');
      terminal.show();
      terminal.sendText(`cd "${uri[0].fsPath}" && git clone ${repo.sshUrl}`);
    }
  }
}

