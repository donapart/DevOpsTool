import { IComputeProvider, Server } from '../core/providers';
import * as vscode from 'vscode';
import { SimpleCache } from '../util/cache';
import { logDebug, logInfo, logError } from '../util/logging';
import { AuthError, ApiError, isAuthError } from '../util/errors';

const TAG = 'Hetzner';

export class HetznerCloudProvider implements IComputeProvider {
  readonly id = 'hetzner-cloud';
  readonly label = 'Hetzner Cloud';
  readonly type = 'compute' as const;

  private cache = new SimpleCache<Server[]>(30000); // 30s TTL

  constructor(private secrets: vscode.SecretStorage) {}

  async isConfigured(): Promise<boolean> {
    const token = await this.secrets.get('hetzner.cloud.token');
    return !!token;
  }

  invalidateCache(): void {
    this.cache.clear();
  }

  async listProjects(): Promise<string[]> {
    return ['default'];
  }

  async listServers(project?: string): Promise<Server[]> {
    const token = await this.secrets.get('hetzner.cloud.token');
    
    if (!token) {
      logDebug(TAG, 'No token configured, returning empty state');
      return [{
        id: '__no_token__',
        name: '⚠️ Token nicht konfiguriert',
        status: 'unknown',
        publicIp: '',
        project: 'default'
      }];
    }

    return this.cache.getOrFetch('servers', async () => {
      logInfo(TAG, 'Fetching servers from API...');

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
        project: 'default'
      }));

      logInfo(TAG, `Loaded ${servers.length} servers`);
      return servers;
    });
  }

  async rebootServer(id: string): Promise<void> {
    logInfo(TAG, `Rebooting server ${id}`);
    await this.performAction(id, 'reboot');
    this.invalidateCache();
  }

  async powerOffServer(id: string): Promise<void> {
    logInfo(TAG, `Powering off server ${id}`);
    await this.performAction(id, 'poweroff');
    this.invalidateCache();
  }

  async powerOnServer(id: string): Promise<void> {
    logInfo(TAG, `Powering on server ${id}`);
    await this.performAction(id, 'poweron');
    this.invalidateCache();
  }

  async enableRescueMode(id: string): Promise<{ rootPassword: string }> {
    logInfo(TAG, `Enabling rescue mode for server ${id}`);
    const result = await this.performAction(id, 'enable_rescue', { type: 'linux64' });
    this.invalidateCache();
    return { rootPassword: result?.root_password || '' };
  }

  async createSnapshot(id: string, name?: string): Promise<void> {
    const description = name || `Snapshot-${new Date().toISOString().slice(0, 19)}`;
    logInfo(TAG, `Creating snapshot for server ${id}: ${description}`);
    await this.performAction(id, 'create_image', { 
      description,
      type: 'snapshot'
    });
    this.invalidateCache();
  }

  async resetServer(id: string): Promise<void> {
    logInfo(TAG, `Hard reset server ${id}`);
    await this.performAction(id, 'reset');
    this.invalidateCache();
  }

  private async performAction(serverId: string, action: string, params: any = {}): Promise<any> {
    const token = await this.secrets.get('hetzner.cloud.token');
    if (!token) throw new AuthError('Hetzner');

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
