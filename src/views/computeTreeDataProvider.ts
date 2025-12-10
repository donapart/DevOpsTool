import * as vscode from 'vscode';
import { ProviderManager } from '../core/providerManager';
import { IComputeProvider, Server } from '../core/providers';
import { logError } from '../util/logging';

export class ComputeTreeDataProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private pm: ProviderManager) {}

  refresh() {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    try {
      if (!element) {
        const computeProviders = this.pm.getComputeProviders();
        return computeProviders.map(p => {
          const item = new vscode.TreeItem(p.label, vscode.TreeItemCollapsibleState.Expanded);
          item.contextValue = 'computeProvider';
          item.id = p.id;
          item.iconPath = new vscode.ThemeIcon('cloud');
          return item;
        });
      }

      const providerId = element.id;
      if (providerId) {
        const provider = this.pm.getComputeProviders().find(p => p.id === providerId);
        if (provider) {
          const servers = await provider.listServers();
          return servers.map(s => new ServerTreeItem(s, provider.id));
        }
      }

      return [];
    } catch (err) {
      logError('ComputeTree', 'Failed to load tree data', err);
      return [new ErrorTreeItem(err)];
    }
  }
}

class ServerTreeItem extends vscode.TreeItem {
  constructor(public readonly server: Server, public readonly providerId: string) {
    super(server.name, vscode.TreeItemCollapsibleState.None);
    
    // Status-based icon coloring
    let iconColor: vscode.ThemeColor;
    let statusEmoji = '';
    
    switch (server.status) {
      case 'running':
        iconColor = new vscode.ThemeColor('charts.green');
        statusEmoji = '🟢';
        break;
      case 'off':
        iconColor = new vscode.ThemeColor('charts.red');
        statusEmoji = '🔴';
        break;
      case 'migrating':
      case 'initializing':
      case 'starting':
        iconColor = new vscode.ThemeColor('charts.yellow');
        statusEmoji = '🟡';
        break;
      case 'stopping':
      case 'deleting':
        iconColor = new vscode.ThemeColor('charts.orange');
        statusEmoji = '🟠';
        break;
      default:
        iconColor = new vscode.ThemeColor('charts.gray');
        statusEmoji = '⚪';
    }
    
    this.iconPath = new vscode.ThemeIcon('server', iconColor);
    this.description = server.publicIp || 'Keine IP';
    this.tooltip = `${statusEmoji} ${server.name}\nStatus: ${server.status}\nIP: ${server.publicIp || 'N/A'}`;
    
    if (server.id === '__no_token__') {
      this.contextValue = 'noToken';
      this.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('charts.yellow'));
      this.command = {
        command: 'devops.setHetznerToken',
        title: 'Token setzen'
      };
    } else {
      this.contextValue = 'server';
    }
  }
  
  get publicIp(): string | undefined {
    return this.server.publicIp;
  }
}

class ErrorTreeItem extends vscode.TreeItem {
  constructor(error: unknown) {
    const message = error instanceof Error ? error.message : 'Unbekannter Fehler';
    super(`❌ ${message}`, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('charts.red'));
  }
}

// Export for use in commands
export { ServerTreeItem };
