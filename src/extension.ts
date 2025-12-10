import * as vscode from 'vscode';
import { ProviderManager } from './core/providerManager';
import { AccountManager } from './core/accounts';
import { ProjectManager } from './core/projects';
import { IonosDnsProvider } from './providers/ionosDnsProvider';
import { HetznerCloudProvider } from './providers/hetznerCloudProvider';
import { CloudflareProvider } from './providers/cloudflareProvider';
import { GoogleDnsProvider } from './providers/googleDnsProvider';
import { AwsRoute53Provider } from './providers/awsRoute53Provider';
import { DomainsTreeDataProvider } from './views/domainsTreeDataProvider';
import { ComputeTreeDataProvider } from './views/computeTreeDataProvider';
import { MindmapWebviewProvider } from './views/mindmapWebview';
import { registerBridgeCommands } from './bridge/commands';
import { registerAccountCommands } from './bridge/accountCommands';
import { registerProjectCommands } from './bridge/projectCommands';
import { registerStatusCommands } from './bridge/statusCommands';
import { logInfo } from './util/logging';

export async function activate(context: vscode.ExtensionContext) {
  logInfo('Extension', 'DevOps Hybrid Cockpit wird aktiviert...');

  // Initialize Account Manager
  const accountManager = new AccountManager(context.globalState, context.secrets);
  await accountManager.initialize();

  // Initialize Project Manager
  const projectManager = new ProjectManager(context.globalState);
  await projectManager.initialize();

  // Migrate legacy tokens (from v0.1.x)
  const migrated = await accountManager.migrateFromLegacy();
  if (migrated) {
    logInfo('Extension', 'Legacy tokens wurden migriert');
  }

  // Initialize Provider Manager
  const pm = new ProviderManager();

  const ionosProvider = new IonosDnsProvider(accountManager, context.secrets);
  const hetznerProvider = new HetznerCloudProvider(accountManager, context.secrets);
  const cloudflareProvider = new CloudflareProvider(accountManager, context.secrets);
  const googleDnsProvider = new GoogleDnsProvider(accountManager, context.secrets);
  const awsRoute53Provider = new AwsRoute53Provider(accountManager, context.secrets);

  pm.registerDnsProvider(ionosProvider);
  pm.registerDnsProvider(cloudflareProvider);
  pm.registerDnsProvider(googleDnsProvider);
  pm.registerDnsProvider(awsRoute53Provider);
  pm.registerComputeProvider(hetznerProvider);

  // Initialize Tree Views
  const domainsTreeProvider = new DomainsTreeDataProvider(pm, accountManager, projectManager);
  const computeTreeProvider = new ComputeTreeDataProvider(pm, accountManager, projectManager);

  vscode.window.registerTreeDataProvider('devopsDomainsView', domainsTreeProvider);
  vscode.window.registerTreeDataProvider('devopsComputeView', computeTreeProvider);

  // Update context for welcome views
  async function updateTokenContext(): Promise<void> {
    const ionosConfigured = await ionosProvider.isConfigured();
    const hetznerConfigured = await hetznerProvider.isConfigured();
    vscode.commands.executeCommand('setContext', 'devops.ionosConfigured', ionosConfigured);
    vscode.commands.executeCommand('setContext', 'devops.hetznerConfigured', hetznerConfigured);
  }
  
  await updateTokenContext();

  // Callback when accounts change - must be async to properly await context updates
  async function onAccountsChanged(): Promise<void> {
    ionosProvider.invalidateCache();
    hetznerProvider.invalidateCache();
    cloudflareProvider.invalidateCache();
    googleDnsProvider.invalidateCache();
    awsRoute53Provider.invalidateCache();
    await updateTokenContext();
    domainsTreeProvider.refresh();
    computeTreeProvider.refresh();
  }

  // Callback when projects change
  function onProjectsChanged() {
    domainsTreeProvider.refresh();
    computeTreeProvider.refresh();
  }

  // Register commands
  registerAccountCommands(context, accountManager, onAccountsChanged);
  registerProjectCommands(context, projectManager, onProjectsChanged);
  registerStatusCommands(context, pm, accountManager, projectManager);
  registerBridgeCommands(context, pm, ionosProvider, hetznerProvider, onAccountsChanged);

  context.subscriptions.push(
    vscode.commands.registerCommand('devops.refreshAll', async () => {
      ionosProvider.invalidateCache();
      hetznerProvider.invalidateCache();
      cloudflareProvider.invalidateCache();
      googleDnsProvider.invalidateCache();
      awsRoute53Provider.invalidateCache();
      await updateTokenContext();
      domainsTreeProvider.refresh();
      computeTreeProvider.refresh();
      logInfo('Extension', 'Views refreshed');
    }),
    vscode.commands.registerCommand('devops.showMindmap', () => {
      MindmapWebviewProvider.createOrShow(context, pm, accountManager, projectManager);
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
