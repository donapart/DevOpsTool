import * as vscode from 'vscode';
import { ProviderManager } from '../core/providerManager';
import { AccountManager, AccountColorLabels } from '../core/accounts';
import { ProjectManager } from '../core/projects';
import { Server } from '../core/providers';
import { HetznerCloudProvider, HetznerServerWithAccount } from '../providers/hetznerCloudProvider';
import { logError } from '../util/logging';

export class ComputeTreeDataProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(
    private pm: ProviderManager,
    private accountManager: AccountManager,
    private projectManager: ProjectManager
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
        // Root level: Show accounts grouped
        const hetznerProvider = this.pm.getComputeProviders().find(p => p.id === 'hetzner-cloud') as HetznerCloudProvider | undefined;
        if (!hetznerProvider) return [];

        const accounts = hetznerProvider.getAccounts();
        
        if (accounts.length === 0) {
          return [new AddAccountItem('hetzner-cloud')];
        }

        return accounts.map(account => new AccountTreeItem(account));
      }

      // Account level: Show servers
      if (element instanceof AccountTreeItem) {
        const hetznerProvider = this.pm.getComputeProviders().find(p => p.id === 'hetzner-cloud') as HetznerCloudProvider | undefined;
        if (!hetznerProvider) return [];

        const allServers = await hetznerProvider.listServers();
        const accountServers = allServers.filter(s => s.accountId === element.account.id);
        
        if (accountServers.length === 0) {
          return [new EmptyItem('Keine Server gefunden')];
        }

        return accountServers.map(s => {
          const displayInfo = this.projectManager.getResourceDisplayInfo('hetzner-cloud', s.id);
          return new ServerTreeItem(s, displayInfo);
        });
      }

      return [];
    } catch (err) {
      logError('ComputeTree', 'Failed to load tree data', err);
      return [new ErrorTreeItem(err)];
    }
  }
}

class AccountTreeItem extends vscode.TreeItem {
  constructor(public readonly account: { id: string; name: string; color: string; isDefault?: boolean }) {
    const colorEmoji = AccountColorLabels[account.color as keyof typeof AccountColorLabels]?.split(' ')[0] || '⚪';
    super(`${colorEmoji} ${account.name}${account.isDefault ? ' ⭐' : ''}`, vscode.TreeItemCollapsibleState.Expanded);
    
    this.contextValue = 'account';
    this.iconPath = new vscode.ThemeIcon('account');
    this.tooltip = `Account: ${account.name}\nKlicken zum Bearbeiten`;
  }
}

class ServerTreeItem extends vscode.TreeItem {
  constructor(
    public readonly server: HetznerServerWithAccount,
    public readonly displayInfo: { project?: any; tags: string[]; color: string; notes?: string }
  ) {
    const projectLabel = displayInfo.project ? ` [${displayInfo.project.name}]` : '';
    const tagsLabel = displayInfo.tags.length > 0 ? ` 🏷️ ${displayInfo.tags.join(', ')}` : '';
    
    super(`${server.name}${projectLabel}${tagsLabel}`, vscode.TreeItemCollapsibleState.None);
    
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
        iconColor = new vscode.ThemeColor('disabledForeground');
        statusEmoji = '⚪';
    }
    
    // Use project/resource color if available, otherwise status color
    const finalColor = displayInfo.color ? new vscode.ThemeColor(displayInfo.color) : iconColor;
    this.iconPath = new vscode.ThemeIcon('server', finalColor);
    this.description = server.publicIp || 'Keine IP';
    
    const tooltipParts = [
      `${statusEmoji} ${server.name}`,
      `Status: ${server.status}`,
      `IP: ${server.publicIp || 'N/A'}`,
      `Account: ${server.accountName}`
    ];
    if (displayInfo.project) {
      tooltipParts.push(`Projekt: ${displayInfo.project.name}`);
    }
    if (displayInfo.tags.length > 0) {
      tooltipParts.push(`Tags: ${displayInfo.tags.join(', ')}`);
    }
    if (displayInfo.notes) {
      tooltipParts.push(`Notiz: ${displayInfo.notes}`);
    }
    this.tooltip = tooltipParts.join('\n');
    
    if (server.id.startsWith('__no_account')) {
      this.contextValue = 'noAccount';
      this.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('charts.yellow'));
      this.command = {
        command: 'devops.addAccount',
        title: 'Account hinzufügen'
      };
    } else if (server.id.startsWith('__error')) {
      this.contextValue = 'error';
      this.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('charts.red'));
    } else {
      this.contextValue = 'server';
    }
  }
  
  get publicIp(): string | undefined {
    return this.server.publicIp;
  }

  get providerId(): string { return 'hetzner-cloud'; }
  get accountId(): string { return this.server.accountId; }
  get resourceId(): string { return this.server.id; }
  get resourceName(): string { return this.server.name; }
}

class AddAccountItem extends vscode.TreeItem {
  constructor(provider: string) {
    super('Account hinzufügen...', vscode.TreeItemCollapsibleState.None);
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

export { ServerTreeItem };
