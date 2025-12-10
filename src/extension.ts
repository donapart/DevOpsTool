import * as vscode from 'vscode';
import { ProviderManager } from './core/providerManager';
import { AccountManager } from './core/accounts';
import { IonosDnsProvider } from './providers/ionosDnsProvider';
import { HetznerCloudProvider } from './providers/hetznerCloudProvider';
import { DomainsTreeDataProvider } from './views/domainsTreeDataProvider';
import { ComputeTreeDataProvider } from './views/computeTreeDataProvider';
import { registerBridgeCommands } from './bridge/commands';
import { registerAccountCommands } from './bridge/accountCommands';
import { logInfo } from './util/logging';

export async function activate(context: vscode.ExtensionContext) {
  logInfo('Extension', 'DevOps Hybrid Cockpit wird aktiviert...');

  // Initialize Account Manager
  const accountManager = new AccountManager(context.globalState, context.secrets);
  await accountManager.initialize();

  // Migrate legacy tokens (from v0.1.x)
  const migrated = await accountManager.migrateFromLegacy();
  if (migrated) {
    logInfo('Extension', 'Legacy tokens wurden migriert');
  }

  // Initialize Provider Manager
  const pm = new ProviderManager();

  const ionosProvider = new IonosDnsProvider(accountManager, context.secrets);
  const hetznerProvider = new HetznerCloudProvider(accountManager, context.secrets);

  pm.registerDnsProvider(ionosProvider);
  pm.registerComputeProvider(hetznerProvider);

  // Initialize Tree Views
  const domainsTreeProvider = new DomainsTreeDataProvider(pm, accountManager);
  const computeTreeProvider = new ComputeTreeDataProvider(pm, accountManager);

  vscode.window.registerTreeDataProvider('devopsDomainsView', domainsTreeProvider);
  vscode.window.registerTreeDataProvider('devopsComputeView', computeTreeProvider);

  // Update context for welcome views
  async function updateTokenContext() {
    const ionosConfigured = await ionosProvider.isConfigured();
    const hetznerConfigured = await hetznerProvider.isConfigured();
    vscode.commands.executeCommand('setContext', 'devops.ionosConfigured', ionosConfigured);
    vscode.commands.executeCommand('setContext', 'devops.hetznerConfigured', hetznerConfigured);
  }
  
  await updateTokenContext();

  // Callback when accounts change
  function onAccountsChanged() {
    ionosProvider.invalidateCache();
    hetznerProvider.invalidateCache();
    updateTokenContext();
    domainsTreeProvider.refresh();
    computeTreeProvider.refresh();
  }

  // Register commands
  registerAccountCommands(context, accountManager, onAccountsChanged);
  registerBridgeCommands(context, pm, ionosProvider, hetznerProvider, onAccountsChanged);

  context.subscriptions.push(
    vscode.commands.registerCommand('devops.refreshAll', async () => {
      ionosProvider.invalidateCache();
      hetznerProvider.invalidateCache();
      await updateTokenContext();
      domainsTreeProvider.refresh();
      computeTreeProvider.refresh();
      logInfo('Extension', 'Views refreshed');
    })
  );

  logInfo('Extension', 'DevOps Hybrid Cockpit aktiviert ✅');
  
  // Show migration notice if needed
  if (migrated) {
    vscode.window.showInformationMessage(
      'DevOps Hybrid: Ihre bestehenden Tokens wurden in das neue Multi-Account-System migriert.',
      'Accounts verwalten'
    ).then(selection => {
      if (selection) {
        vscode.commands.executeCommand('devops.listAccounts');
      }
    });
  }
}

export function deactivate() {
  logInfo('Extension', 'DevOps Hybrid Cockpit deaktiviert.');
}
