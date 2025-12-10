import * as vscode from 'vscode';
import { ProviderManager } from '../core/providerManager';
import { AccountManager, AccountColorLabels } from '../core/accounts';
import { ProjectManager } from '../core/projects';
import { DnsRecord } from '../core/providers';
import { IonosDnsProvider, IonosDomainWithAccount } from '../providers/ionosDnsProvider';
import { logError } from '../util/logging';

export class DomainsTreeDataProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
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
        const ionosProvider = this.pm.getDnsProviders().find(p => p.id === 'ionos-dns') as IonosDnsProvider | undefined;
        if (!ionosProvider) return [];

        const accounts = ionosProvider.getAccounts();
        
        if (accounts.length === 0) {
          return [new AddAccountItem('ionos-dns')];
        }

        // Group by account
        return accounts.map(account => new AccountTreeItem(account));
      }

      // Account level: Show domains
      if (element instanceof AccountTreeItem) {
        const ionosProvider = this.pm.getDnsProviders().find(p => p.id === 'ionos-dns') as IonosDnsProvider | undefined;
        if (!ionosProvider) return [];

        const allDomains = await ionosProvider.listDomains();
        const accountDomains = allDomains.filter(d => d.accountId === element.account.id);
        
        if (accountDomains.length === 0) {
          return [new EmptyItem('Keine Domains gefunden')];
        }

        return accountDomains.map(d => {
          const displayInfo = this.projectManager.getResourceDisplayInfo('ionos-dns', d.id);
          return new DomainTreeItem(d, displayInfo);
        });
      }

      // Domain level: Show records
      if (element instanceof DomainTreeItem) {
        const domain = element.domain;
        if (domain.id.startsWith('__')) {
          return [];
        }
        return domain.records.map(r => new RecordTreeItem(r, element.domain));
      }

      return [];
    } catch (err) {
      logError('DomainsTree', 'Failed to load tree data', err);
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

class DomainTreeItem extends vscode.TreeItem {
  constructor(
    public readonly domain: IonosDomainWithAccount,
    public readonly displayInfo: { project?: any; tags: string[]; color: string; notes?: string }
  ) {
    const projectLabel = displayInfo.project ? ` [${displayInfo.project.name}]` : '';
    const tagsLabel = displayInfo.tags.length > 0 ? ` 🏷️ ${displayInfo.tags.join(', ')}` : '';
    
    super(`${domain.name}${projectLabel}${tagsLabel}`, domain.records.length > 0 
      ? vscode.TreeItemCollapsibleState.Collapsed 
      : vscode.TreeItemCollapsibleState.None);
    
    this.contextValue = domain.id.startsWith('__') ? 'noData' : 'domain';
    
    // Use project/resource color if available
    const color = displayInfo.color || domain.accountColor;
    this.iconPath = new vscode.ThemeIcon('globe', color ? new vscode.ThemeColor(color) : undefined);
    
    this.description = `${domain.records.length} Records`;
    this.tooltip = displayInfo.notes || undefined;
    
    if (domain.id.startsWith('__error')) {
      this.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('charts.red'));
    } else if (domain.id.startsWith('__no')) {
      this.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('charts.yellow'));
    }
  }

  get providerId(): string { return 'ionos-dns'; }
  get resourceId(): string { return this.domain.id; }
  get resourceName(): string { return this.domain.name; }
}

class RecordTreeItem extends vscode.TreeItem {
  constructor(
    public readonly record: DnsRecord,
    public readonly domain: IonosDomainWithAccount
  ) {
    super(`${record.type} ${record.name}`, vscode.TreeItemCollapsibleState.None);
    
    this.description = record.value;
    this.tooltip = `${record.type} Record\nName: ${record.name}\nValue: ${record.value}\nTTL: ${record.ttl}s\nAccount: ${domain.accountName}`;
    this.contextValue = 'record';
    
    switch (record.type) {
      case 'A':
      case 'AAAA':
        this.iconPath = new vscode.ThemeIcon('globe');
        break;
      case 'MX':
        this.iconPath = new vscode.ThemeIcon('mail');
        break;
      case 'CNAME':
        this.iconPath = new vscode.ThemeIcon('link');
        break;
      case 'TXT':
        this.iconPath = new vscode.ThemeIcon('note');
        break;
      case 'NS':
        this.iconPath = new vscode.ThemeIcon('server');
        break;
      default:
        this.iconPath = new vscode.ThemeIcon('symbol-variable');
    }
  }

  // For commands to access
  get providerId(): string { return 'ionos-dns'; }
  get domainId(): string { return this.domain.id; }
  get domainName(): string { return this.domain.name; }
  get accountId(): string { return this.domain.accountId; }
  get publicIp(): string | undefined {
    return (this.record.type === 'A' || this.record.type === 'AAAA') ? this.record.value : undefined;
  }
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

export { DomainTreeItem, RecordTreeItem };
