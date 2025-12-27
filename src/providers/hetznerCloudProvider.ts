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

export interface HetznerSshKey {
  id: number;
  name: string;
  fingerprint: string;
  publicKey: string;
  labels: Record<string, string>;
  created: string;
  accountId: string;
  accountName: string;
  accountColor: string;
}

export interface HetznerVolume {
  id: number;
  name: string;
  size: number;
  status: string;
  serverId: number | null;
  location: string;
  labels: Record<string, string>;
  created: string;
  accountId: string;
  accountName: string;
  accountColor: string;
}

export class HetznerCloudProvider implements IComputeProvider {
  readonly id = 'hetzner-cloud';
  readonly label = 'Hetzner Cloud';
  readonly type = 'compute' as const;

  private cache = new SimpleCache<HetznerServerWithAccount[]>(30000);
  private sshKeyCache = new SimpleCache<HetznerSshKey[]>(30000);
  private volumeCache = new SimpleCache<HetznerVolume[]>(30000);

  constructor(
    private accountManager: AccountManager,
    private secrets: vscode.SecretStorage
  ) {}

  async isConfigured(): Promise<boolean> {
    return this.accountManager.hasAccountsForProvider('hetzner-cloud');
  }

  invalidateCache(): void {
    this.cache.clear();
    this.sshKeyCache.clear();
    this.volumeCache.clear();
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

  // =============================================
  // SSH KEYS
  // =============================================
  async listSshKeys(): Promise<HetznerSshKey[]> {
    const accounts = this.getAccounts();
    
    if (accounts.length === 0) {
      return [];
    }

    return this.sshKeyCache.getOrFetch('all-ssh-keys', async () => {
      const allKeys: HetznerSshKey[] = [];

      for (const account of accounts) {
        try {
          const token = await this.accountManager.getToken(account.id);
          if (!token) continue;

          const keys = await this.fetchSshKeysForAccount(account, token);
          allKeys.push(...keys);
        } catch (err) {
          logError(TAG, `Failed to fetch SSH keys for account ${account.name}`, err);
        }
      }

      return allKeys;
    });
  }

  private async fetchSshKeysForAccount(account: Account, token: string): Promise<HetznerSshKey[]> {
    logInfo(TAG, `Fetching SSH keys for account: ${account.name}`);

    const response = await fetch('https://api.hetzner.cloud/v1/ssh_keys', {
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
    const keys = (data.ssh_keys || []).map((k: any) => ({
      id: k.id,
      name: k.name,
      fingerprint: k.fingerprint,
      publicKey: k.public_key,
      labels: k.labels || {},
      created: k.created,
      accountId: account.id,
      accountName: account.name,
      accountColor: AccountColorMap[account.color]
    }));

    logInfo(TAG, `Loaded ${keys.length} SSH keys for ${account.name}`);
    return keys;
  }

  async createSshKey(name: string, publicKey: string, accountId?: string): Promise<HetznerSshKey> {
    const { account, token } = await this.getTokenForAccount(accountId);
    logInfo(TAG, `Creating SSH key: ${name} (Account: ${account.name})`);

    const response = await fetch('https://api.hetzner.cloud/v1/ssh_keys', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ name, public_key: publicKey })
    });

    if (!response.ok) {
      const err = await response.text();
      throw new ApiError('Hetzner', response.status, response.statusText, err);
    }

    const data: any = await response.json();
    this.sshKeyCache.clear();
    
    return {
      id: data.ssh_key.id,
      name: data.ssh_key.name,
      fingerprint: data.ssh_key.fingerprint,
      publicKey: data.ssh_key.public_key,
      labels: data.ssh_key.labels || {},
      created: data.ssh_key.created,
      accountId: account.id,
      accountName: account.name,
      accountColor: AccountColorMap[account.color]
    };
  }

  async deleteSshKey(id: number, accountId?: string): Promise<void> {
    const { account, token } = await this.getTokenForAccount(accountId);
    logInfo(TAG, `Deleting SSH key: ${id} (Account: ${account.name})`);

    const response = await fetch(`https://api.hetzner.cloud/v1/ssh_keys/${id}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) {
      const err = await response.text();
      throw new ApiError('Hetzner', response.status, response.statusText, err);
    }

    this.sshKeyCache.clear();
  }

  // =============================================
  // VOLUMES (Storage)
  // =============================================
  async listVolumes(): Promise<HetznerVolume[]> {
    const accounts = this.getAccounts();
    
    if (accounts.length === 0) {
      return [];
    }

    return this.volumeCache.getOrFetch('all-volumes', async () => {
      const allVolumes: HetznerVolume[] = [];

      for (const account of accounts) {
        try {
          const token = await this.accountManager.getToken(account.id);
          if (!token) continue;

          const volumes = await this.fetchVolumesForAccount(account, token);
          allVolumes.push(...volumes);
        } catch (err) {
          logError(TAG, `Failed to fetch volumes for account ${account.name}`, err);
        }
      }

      return allVolumes;
    });
  }

  private async fetchVolumesForAccount(account: Account, token: string): Promise<HetznerVolume[]> {
    logInfo(TAG, `Fetching volumes for account: ${account.name}`);

    const response = await fetch('https://api.hetzner.cloud/v1/volumes', {
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
    const volumes = (data.volumes || []).map((v: any) => ({
      id: v.id,
      name: v.name,
      size: v.size,
      status: v.status,
      serverId: v.server,
      location: v.location?.name || 'unknown',
      labels: v.labels || {},
      created: v.created,
      accountId: account.id,
      accountName: account.name,
      accountColor: AccountColorMap[account.color]
    }));

    logInfo(TAG, `Loaded ${volumes.length} volumes for ${account.name}`);
    return volumes;
  }

  async createVolume(name: string, size: number, location: string, accountId?: string): Promise<HetznerVolume> {
    const { account, token } = await this.getTokenForAccount(accountId);
    logInfo(TAG, `Creating volume: ${name} (${size}GB) in ${location} (Account: ${account.name})`);

    const response = await fetch('https://api.hetzner.cloud/v1/volumes', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ name, size, location, automount: false })
    });

    if (!response.ok) {
      const err = await response.text();
      throw new ApiError('Hetzner', response.status, response.statusText, err);
    }

    const data: any = await response.json();
    this.volumeCache.clear();
    
    return {
      id: data.volume.id,
      name: data.volume.name,
      size: data.volume.size,
      status: data.volume.status,
      serverId: data.volume.server,
      location: data.volume.location?.name || location,
      labels: data.volume.labels || {},
      created: data.volume.created,
      accountId: account.id,
      accountName: account.name,
      accountColor: AccountColorMap[account.color]
    };
  }

  async deleteVolume(id: number, accountId?: string): Promise<void> {
    const { account, token } = await this.getTokenForAccount(accountId);
    logInfo(TAG, `Deleting volume: ${id} (Account: ${account.name})`);

    const response = await fetch(`https://api.hetzner.cloud/v1/volumes/${id}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) {
      const err = await response.text();
      throw new ApiError('Hetzner', response.status, response.statusText, err);
    }

    this.volumeCache.clear();
  }
}
