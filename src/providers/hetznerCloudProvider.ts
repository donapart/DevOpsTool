import { IComputeProvider, Server, RescueModeResult } from '../core/providers';
import { AccountManager, Account, AccountColorMap } from '../core/accounts';
import * as vscode from 'vscode';
import { SimpleCache } from '../util/cache';
import { logDebug, logInfo, logError } from '../util/logging';
import { AuthError, ApiError, isAuthError } from '../util/errors';

const TAG = 'Hetzner';

export interface HetznerServerWithAccount extends Server {
  accountId: string;
  accountName: string;
  accountColor: string;
}

export class HetznerCloudProvider implements IComputeProvider {
  readonly id = 'hetzner-cloud';
  readonly label = 'Hetzner Cloud';
  readonly type = 'compute' as const;

  private cache = new SimpleCache<HetznerServerWithAccount[]>(30000);

  constructor(
    private accountManager: AccountManager,
    private secrets: vscode.SecretStorage
  ) {}

  async isConfigured(): Promise<boolean> {
    return this.accountManager.hasAccountsForProvider('hetzner-cloud');
  }

  invalidateCache(): void {
    this.cache.clear();
  }

  getAccounts(): Account[] {
    return this.accountManager.getByProvider('hetzner-cloud');
  }

  async listProjects(): Promise<string[]> {
    return ['default'];
  }

  async listServers(project?: string): Promise<HetznerServerWithAccount[]> {
    const accounts = this.getAccounts();
    
    if (accounts.length === 0) {
      return [{
        id: '__no_account__',
        name: '⚠️ Kein Account konfiguriert',
        status: 'unknown',
        publicIp: '',
        project: 'default',
        accountId: '',
        accountName: '',
        accountColor: ''
      }];
    }

    return this.cache.getOrFetch('all-servers', async () => {
      const allServers: HetznerServerWithAccount[] = [];

      for (const account of accounts) {
        try {
          const token = await this.accountManager.getToken(account.id);
          if (!token) continue;

          const servers = await this.fetchServersForAccount(account, token);
          allServers.push(...servers);
        } catch (err) {
          logError(TAG, `Failed to fetch servers for account ${account.name}`, err);
          allServers.push({
            id: `__error_${account.id}__`,
            name: `❌ ${account.name}: Fehler beim Laden`,
            status: 'unknown',
            publicIp: '',
            project: 'default',
            accountId: account.id,
            accountName: account.name,
            accountColor: AccountColorMap[account.color]
          });
        }
      }

      return allServers;
    });
  }

  private async fetchServersForAccount(account: Account, token: string): Promise<HetznerServerWithAccount[]> {
    logInfo(TAG, `Fetching servers for account: ${account.name}`);

    const response = await fetch('https://api.hetzner.cloud/v1/servers', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) {
      if (isAuthError(response.status)) {
        throw new AuthError('Hetzner');
      }
      throw new ApiError('Hetzner', response.status, response.statusText);
    }

    const data: any = await response.json();
    const servers = (data.servers || []).map((s: any) => ({
      id: s.id.toString(),
      name: s.name,
      status: s.status as Server['status'],
      publicIp: s.public_net?.ipv4?.ip,
      project: 'default',
      accountId: account.id,
      accountName: account.name,
      accountColor: AccountColorMap[account.color]
    }));

    logInfo(TAG, `Loaded ${servers.length} servers for ${account.name}`);
    return servers;
  }

  private async getTokenForAccount(accountId?: string): Promise<{ account: Account; token: string }> {
    const account = accountId 
      ? this.accountManager.getById(accountId)
      : this.accountManager.getDefaultForProvider('hetzner-cloud');
    
    if (!account) throw new Error('Kein Account konfiguriert');
    
    const token = await this.accountManager.getToken(account.id);
    if (!token) throw new AuthError('Hetzner');

    return { account, token };
  }

  async rebootServer(id: string, accountId?: string): Promise<void> {
    const { account } = await this.getTokenForAccount(accountId);
    logInfo(TAG, `Rebooting server ${id} (Account: ${account.name})`);
    await this.performAction(id, 'reboot', {}, accountId);
    this.invalidateCache();
  }

  async powerOffServer(id: string, accountId?: string): Promise<void> {
    const { account } = await this.getTokenForAccount(accountId);
    logInfo(TAG, `Powering off server ${id} (Account: ${account.name})`);
    await this.performAction(id, 'poweroff', {}, accountId);
    this.invalidateCache();
  }

  async powerOnServer(id: string, accountId?: string): Promise<void> {
    const { account } = await this.getTokenForAccount(accountId);
    logInfo(TAG, `Powering on server ${id} (Account: ${account.name})`);
    await this.performAction(id, 'poweron', {}, accountId);
    this.invalidateCache();
  }

  async enableRescueMode(id: string, accountId?: string): Promise<RescueModeResult> {
    const { account } = await this.getTokenForAccount(accountId);
    logInfo(TAG, `Enabling rescue mode for server ${id} (Account: ${account.name})`);
    const result = await this.performAction(id, 'enable_rescue', { type: 'linux64' }, accountId);
    this.invalidateCache();
    return { rootPassword: result?.root_password || '' };
  }

  async createSnapshot(id: string, name?: string, accountId?: string): Promise<void> {
    const { account } = await this.getTokenForAccount(accountId);
    const description = name || `Snapshot-${new Date().toISOString().slice(0, 19)}`;
    logInfo(TAG, `Creating snapshot for server ${id}: ${description} (Account: ${account.name})`);
    await this.performAction(id, 'create_image', { 
      description,
      type: 'snapshot'
    }, accountId);
    this.invalidateCache();
  }

  async resetServer(id: string, accountId?: string): Promise<void> {
    const { account } = await this.getTokenForAccount(accountId);
    logInfo(TAG, `Hard reset server ${id} (Account: ${account.name})`);
    await this.performAction(id, 'reset', {}, accountId);
    this.invalidateCache();
  }

  private async performAction(serverId: string, action: string, params: any = {}, accountId?: string): Promise<any> {
    const { token } = await this.getTokenForAccount(accountId);

    logDebug(TAG, `Performing action ${action} on server ${serverId}`);

    const response = await fetch(
      `https://api.hetzner.cloud/v1/servers/${serverId}/actions/${action}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(params)
      }
    );

    if (!response.ok) {
      if (isAuthError(response.status)) {
        throw new AuthError('Hetzner');
      }
      const err = await response.text();
      throw new ApiError('Hetzner', response.status, response.statusText, err);
    }
    
    const resJson: any = await response.json();
    if (resJson.action?.error) {
      throw new Error(`Hetzner Action Error: ${resJson.action.error.message}`);
    }

    logInfo(TAG, `Action ${action} completed for server ${serverId}`);
    return resJson;
  }
}
