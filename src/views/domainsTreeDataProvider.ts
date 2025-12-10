import * as vscode from 'vscode';
import { ProviderManager } from '../core/providerManager';
import { IDnsProvider, Domain, DnsRecord } from '../core/providers';
import { logError } from '../util/logging';

export class DomainsTreeDataProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
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
        const dnsProviders = this.pm.getDnsProviders();
        return dnsProviders.map(p => {
          const item = new vscode.TreeItem(p.label, vscode.TreeItemCollapsibleState.Expanded);
          item.contextValue = 'dnsProvider';
          item.id = p.id;
          item.iconPath = new vscode.ThemeIcon('server-environment');
          return item;
        });
      }

      const providerId = element.id;
      if (providerId) {
        const provider = this.pm.getDnsProviders().find(p => p.id === providerId);
        if (provider) {
          const domains = await provider.listDomains();
          return domains.map(d => new DomainTreeItem(d, provider.id));
        }
      }

      if (element instanceof DomainTreeItem) {
        const domain = element.domain;
        if (domain.id === '__no_token__') {
          return [new ConfigureTokenItem('ionos')];
        }
        return domain.records.map(r => new RecordTreeItem(r, element.providerId, domain.id, domain.name));
      }

      return [];
    } catch (err) {
      logError('DomainsTree', 'Failed to load tree data', err);
      return [new ErrorTreeItem(err)];
    }
  }
}

class DomainTreeItem extends vscode.TreeItem {
  constructor(public readonly domain: Domain, public readonly providerId: string) {
    super(domain.name, domain.records.length > 0 
      ? vscode.TreeItemCollapsibleState.Collapsed 
      : vscode.TreeItemCollapsibleState.None);
    
    this.contextValue = domain.id === '__no_token__' ? 'noToken' : 'domain';
    this.iconPath = new vscode.ThemeIcon('globe');
    this.description = `${domain.records.length} Records`;
    
    if (domain.id === '__no_token__') {
      this.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('charts.yellow'));
    }
  }
}

class RecordTreeItem extends vscode.TreeItem {
  constructor(
    public readonly record: DnsRecord,
    public readonly providerId: string,
    public readonly domainId: string,
    public readonly domainName: string
  ) {
    super(`${record.type} ${record.name}`, vscode.TreeItemCollapsibleState.None);
    
    this.description = record.value;
    this.tooltip = `${record.type} Record\nName: ${record.name}\nValue: ${record.value}\nTTL: ${record.ttl}s`;
    this.contextValue = 'record';
    
    // Different icons per record type
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
  
  get publicIp(): string | undefined {
    return (this.record.type === 'A' || this.record.type === 'AAAA') ? this.record.value : undefined;
  }
}

class ConfigureTokenItem extends vscode.TreeItem {
  constructor(provider: 'ionos' | 'hetzner') {
    super('Token konfigurieren...', vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('key');
    this.command = {
      command: provider === 'ionos' ? 'devops.setIonosToken' : 'devops.setHetznerToken',
      title: 'Token setzen'
    };
  }
}

class ErrorTreeItem extends vscode.TreeItem {
  constructor(error: unknown) {
    const message = error instanceof Error ? error.message : 'Unbekannter Fehler';
    super(`❌ ${message}`, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('charts.red'));
  }
}

// Export the item classes for use in commands
export { DomainTreeItem, RecordTreeItem };
