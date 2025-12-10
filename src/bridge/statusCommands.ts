import * as vscode from 'vscode';
import { ProviderManager } from '../core/providerManager';
import { AccountManager } from '../core/accounts';
import { ProjectManager } from '../core/projects';
import { logInfo, logError, showChannel } from '../util/logging';

const TAG = 'Status';

interface ProviderStatus {
  id: string;
  label: string;
  accounts: number;
  lastError?: string;
  health: 'healthy' | 'warning' | 'error';
}

interface StatusReport {
  timestamp: string;
  accounts: {
    total: number;
    byProvider: Record<string, number>;
  };
  projects: number;
  domains: number;
  servers: number;
  providers: ProviderStatus[];
  summary: string;
}

export function registerStatusCommands(
    context: vscode.ExtensionContext,
    pm: ProviderManager,
    accountManager: AccountManager,
    projectManager: ProjectManager
) {
    context.subscriptions.push(
        vscode.commands.registerCommand('devops.showStatus', async () => {
            try {
                const report = await generateStatusReport(pm, accountManager, projectManager);
                await showStatusReport(report);
            } catch (err) {
                logError(TAG, 'Failed to generate status report', err);
                vscode.window.showErrorMessage(`Fehler beim Generieren des Status-Reports: ${err}`);
            }
        }),

        vscode.commands.registerCommand('devops.exportStatus', async () => {
            try {
                const report = await generateStatusReport(pm, accountManager, projectManager);
                const markdown = formatStatusAsMarkdown(report);
                
                const doc = await vscode.workspace.openTextDocument({
                    content: markdown,
                    language: 'markdown'
                });
                await vscode.window.showTextDocument(doc);
                
                vscode.window.showInformationMessage('Status-Report als Markdown exportiert.');
            } catch (err) {
                logError(TAG, 'Failed to export status', err);
                vscode.window.showErrorMessage(`Fehler beim Export: ${err}`);
            }
        })
    );
}

async function generateStatusReport(
    pm: ProviderManager,
    accountManager: AccountManager,
    projectManager: ProjectManager
): Promise<StatusReport> {
    const accounts = accountManager.getAll();
    const projects = projectManager.getAllProjects();
    
    const accountsByProvider: Record<string, number> = {};
    accounts.forEach(acc => {
        accountsByProvider[acc.provider] = (accountsByProvider[acc.provider] || 0) + 1;
    });

    let domainsCount = 0;
    let serversCount = 0;
    const providerStatuses: ProviderStatus[] = [];

    // Check DNS providers
    for (const provider of pm.getDnsProviders()) {
        const providerAccounts = accounts.filter(a => a.provider === provider.id);
        let health: 'healthy' | 'warning' | 'error' = 'healthy';
        let lastError: string | undefined;

        try {
            const domains = await provider.listDomains();
            domainsCount += domains.filter(d => !d.id.startsWith('__')).length;
        } catch (err) {
            health = 'error';
            lastError = err instanceof Error ? err.message : String(err);
        }

        providerStatuses.push({
            id: provider.id,
            label: provider.label,
            accounts: providerAccounts.length,
            lastError,
            health
        });
    }

    // Check Compute providers
    for (const provider of pm.getComputeProviders()) {
        const providerAccounts = accounts.filter(a => a.provider === provider.id);
        let health: 'healthy' | 'warning' | 'error' = 'healthy';
        let lastError: string | undefined;

        try {
            const servers = await provider.listServers();
            serversCount += servers.filter(s => !s.id.startsWith('__')).length;
        } catch (err) {
            health = 'error';
            lastError = err instanceof Error ? err.message : String(err);
        }

        providerStatuses.push({
            id: provider.id,
            label: provider.label,
            accounts: providerAccounts.length,
            lastError,
            health
        });
    }

    const errorCount = providerStatuses.filter(p => p.health === 'error').length;
    const warningCount = providerStatuses.filter(p => p.health === 'warning').length;
    
    let summary = '✅ Alle Systeme funktionieren';
    if (errorCount > 0) {
        summary = `❌ ${errorCount} Provider mit Fehlern`;
    } else if (warningCount > 0) {
        summary = `⚠️ ${warningCount} Provider mit Warnungen`;
    }

    return {
        timestamp: new Date().toISOString(),
        accounts: {
            total: accounts.length,
            byProvider: accountsByProvider
        },
        projects: projects.length,
        domains: domainsCount,
        servers: serversCount,
        providers: providerStatuses,
        summary
    };
}

async function showStatusReport(report: StatusReport): Promise<void> {
    const lines: string[] = [
        `# DevOps Hybrid Cockpit - Status Report`,
        `**${report.summary}**`,
        ``,
        `## Übersicht`,
        `- **Accounts:** ${report.accounts.total}`,
        `- **Projekte:** ${report.projects}`,
        `- **Domains:** ${report.domains}`,
        `- **Server:** ${report.servers}`,
        ``,
        `## Provider Status`,
    ];

    report.providers.forEach(provider => {
        const healthIcon = provider.health === 'healthy' ? '✅' : 
                          provider.health === 'warning' ? '⚠️' : '❌';
        lines.push(`- ${healthIcon} **${provider.label}**: ${provider.accounts} Account(s)`);
        if (provider.lastError) {
            lines.push(`  - Fehler: ${provider.lastError}`);
        }
    });

    lines.push(``);
    lines.push(`*Generiert: ${new Date(report.timestamp).toLocaleString('de-DE')}*`);

    const content = lines.join('\n');
    
    const doc = await vscode.workspace.openTextDocument({
        content,
        language: 'markdown'
    });
    
    await vscode.window.showTextDocument(doc);
    
    // Also show in notification
    vscode.window.showInformationMessage(
        report.summary,
        'Logs anzeigen',
        'Als Markdown exportieren'
    ).then(selection => {
        if (selection === 'Logs anzeigen') {
            showChannel();
        } else if (selection === 'Als Markdown exportieren') {
            vscode.commands.executeCommand('devops.exportStatus');
        }
    });
}

function formatStatusAsMarkdown(report: StatusReport): string {
    const lines: string[] = [
        `# DevOps Hybrid Cockpit - Status Report`,
        ``,
        `**Generiert:** ${new Date(report.timestamp).toLocaleString('de-DE')}`,
        ``,
        `## Zusammenfassung`,
        ``,
        `- **Status:** ${report.summary}`,
        `- **Accounts:** ${report.accounts.total}`,
        `- **Projekte:** ${report.projects}`,
        `- **Domains:** ${report.domains}`,
        `- **Server:** ${report.servers}`,
        ``,
        `## Accounts nach Provider`,
        ``,
    ];

    Object.entries(report.accounts.byProvider).forEach(([provider, count]) => {
        lines.push(`- **${provider}**: ${count}`);
    });

    lines.push(``);
    lines.push(`## Provider Details`, ``);

    report.providers.forEach(provider => {
        const healthIcon = provider.health === 'healthy' ? '✅' : 
                          provider.health === 'warning' ? '⚠️' : '❌';
        lines.push(`### ${healthIcon} ${provider.label}`);
        lines.push(``);
        lines.push(`- **Accounts:** ${provider.accounts}`);
        lines.push(`- **Status:** ${provider.health}`);
        if (provider.lastError) {
            lines.push(`- **Letzter Fehler:** ${provider.lastError}`);
        }
        lines.push(``);
    });

    return lines.join('\n');
}
