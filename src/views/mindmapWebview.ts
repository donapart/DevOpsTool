import * as vscode from 'vscode';
import * as path from 'path';
import { ProviderManager } from '../core/providerManager';
import { AccountManager } from '../core/accounts';
import { ProjectManager } from '../core/projects';
import { logInfo, logError } from '../util/logging';

const TAG = 'Mindmap';

interface GraphData {
  accounts: Array<{ id: string; name: string; provider: string }>;
  projects: Array<{ id: string; name: string; color: string }>;
  domains: Array<{
    id: string;
    name: string;
    accountId: string;
    providerId: string;
    records: Array<{ id: string; type: string; name: string; value: string }>;
  }>;
  servers: Array<{
    id: string;
    name: string;
    accountId: string;
    providerId: string;
    publicIp?: string;
    status: string;
  }>;
  resources: Array<{
    id: string;
    providerId: string;
    projectId?: string;
    tags: string[];
  }>;
}

export class MindmapWebviewProvider {
  private static currentPanel: vscode.WebviewPanel | undefined;

  static createOrShow(
    context: vscode.ExtensionContext,
    pm: ProviderManager,
    accountManager: AccountManager,
    projectManager: ProjectManager
  ) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (MindmapWebviewProvider.currentPanel) {
      MindmapWebviewProvider.currentPanel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'devopsMindmap',
      'DevOps Map',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.file(path.join(context.extensionPath, 'resources'))
        ]
      }
    );

    const htmlPath = vscode.Uri.file(
      path.join(context.extensionPath, 'resources', 'webview', 'mindmap.html')
    );

    panel.webview.html = this.getWebviewContent(panel.webview, htmlPath, context);

    panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.command) {
          case 'requestData':
            await this.updateGraphData(panel.webview, pm, accountManager, projectManager);
            break;
          case 'nodeClick':
            logInfo(TAG, `Node clicked: ${message.nodeId} (${message.nodeType})`);
            vscode.window.showInformationMessage(`Clicked: ${message.nodeType} ${message.nodeId}`);
            break;
          case 'exportData':
            const doc = await vscode.workspace.openTextDocument({
              content: message.data,
              language: 'json'
            });
            await vscode.window.showTextDocument(doc);
            break;
        }
      },
      undefined,
      context.subscriptions
    );

    panel.onDidDispose(
      () => {
        MindmapWebviewProvider.currentPanel = undefined;
      },
      null,
      context.subscriptions
    );

    MindmapWebviewProvider.currentPanel = panel;

    // Load initial data
    this.updateGraphData(panel.webview, pm, accountManager, projectManager);
  }

  private static async updateGraphData(
    webview: vscode.Webview,
    pm: ProviderManager,
    accountManager: AccountManager,
    projectManager: ProjectManager
  ) {
    try {
      logInfo(TAG, 'Collecting graph data...');

      const accounts = accountManager.getAll();
      const projects = projectManager.getAllProjects();

      const graphData: GraphData = {
        accounts: accounts.map(a => ({
          id: a.id,
          name: a.name,
          provider: a.provider
        })),
        projects: projects.map(p => ({
          id: p.id,
          name: p.name,
          color: p.color
        })),
        domains: [],
        servers: [],
        resources: []
      };

      // Collect domains from all DNS providers
      for (const provider of pm.getDnsProviders()) {
        try {
          const domains = await provider.listDomains();
          for (const domain of domains) {
            if (domain.id.startsWith('__')) continue;

            const domainWithAccount = domain as any;
            graphData.domains.push({
              id: domain.id,
              name: domain.name,
              accountId: domainWithAccount.accountId || '',
              providerId: provider.id,
              records: domain.records.map(r => ({
                id: r.id,
                type: r.type,
                name: r.name,
                value: r.value
              }))
            });

            // Add resource metadata
            const metadata = projectManager.getResourceMetadata(provider.id, domain.id);
            graphData.resources.push({
              id: domain.id,
              providerId: provider.id,
              projectId: metadata.projectId,
              tags: metadata.tags
            });
          }
        } catch (err) {
          logError(TAG, `Failed to fetch domains from ${provider.id}`, err);
        }
      }

      // Collect servers from all compute providers
      for (const provider of pm.getComputeProviders()) {
        try {
          const servers = await provider.listServers();
          for (const server of servers) {
            if (server.id.startsWith('__')) continue;

            const serverWithAccount = server as any;
            graphData.servers.push({
              id: server.id,
              name: server.name,
              accountId: serverWithAccount.accountId || '',
              providerId: provider.id,
              publicIp: server.publicIp,
              status: server.status
            });

            // Add resource metadata
            const metadata = projectManager.getResourceMetadata(provider.id, server.id);
            graphData.resources.push({
              id: server.id,
              providerId: provider.id,
              projectId: metadata.projectId,
              tags: metadata.tags
            });
          }
        } catch (err) {
          logError(TAG, `Failed to fetch servers from ${provider.id}`, err);
        }
      }

      logInfo(TAG, `Graph data collected: ${graphData.domains.length} domains, ${graphData.servers.length} servers`);

      webview.postMessage({
        command: 'updateGraph',
        data: graphData
      });
    } catch (err) {
      logError(TAG, 'Failed to update graph data', err);
      vscode.window.showErrorMessage(`Fehler beim Laden der Mindmap: ${err}`);
    }
  }

  private static getWebviewContent(
    webview: vscode.Webview,
    htmlPath: vscode.Uri,
    context: vscode.ExtensionContext
  ): string {
    // Read HTML file and replace resource paths
    const fs = require('fs');
    let html = fs.readFileSync(htmlPath.fsPath, 'utf8');
    
    // Replace any local resource paths with webview URIs
    // (For now, we'll use inline HTML, but this could be enhanced)
    
    return html;
  }
}
