import * as vscode from 'vscode';
import { ProviderManager } from './core/providerManager';
import { IonosDnsProvider } from './providers/ionosDnsProvider';
import { HetznerCloudProvider } from './providers/hetznerCloudProvider';
import { DomainsTreeDataProvider } from './views/domainsTreeDataProvider';
import { ComputeTreeDataProvider } from './views/computeTreeDataProvider';
import { registerBridgeCommands } from './bridge/commands';
import { logInfo } from './util/logging';

export async function activate(context: vscode.ExtensionContext) {
  logInfo('Extension', 'DevOps Hybrid Cockpit wird aktiviert...');

  const pm = new ProviderManager();

  const ionosProvider = new IonosDnsProvider(context.secrets);
  const hetznerProvider = new HetznerCloudProvider(context.secrets);

  pm.registerDnsProvider(ionosProvider);
  pm.registerComputeProvider(hetznerProvider);

  const domainsTreeProvider = new DomainsTreeDataProvider(pm);
  const computeTreeProvider = new ComputeTreeDataProvider(pm);

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

  registerBridgeCommands(context, pm, ionosProvider, hetznerProvider, updateTokenContext);

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
  vscode.window.showInformationMessage('DevOps Hybrid Cockpit aktiviert.');
}

export function deactivate() {
  logInfo('Extension', 'DevOps Hybrid Cockpit deaktiviert.');
}
