import * as vscode from 'vscode';
import { ProviderManager } from '../core/providerManager';
import { isDnsProvider, isComputeProvider } from '../util/guards';
import { ReadOnlyError, UserError, AuthError } from '../util/errors';
import { logInfo, logError, showChannel } from '../util/logging';
import { checkDnsPropagation, formatPropagationResults } from '../util/propagation';
import { RecordTreeItem } from '../views/domainsTreeDataProvider';
import { ServerTreeItem } from '../views/computeTreeDataProvider';
import { IonosDnsProvider } from '../providers/ionosDnsProvider';
import { HetznerCloudProvider } from '../providers/hetznerCloudProvider';

const TAG = 'Commands';
let clipboardIp: string | undefined;

function isReadOnlyMode(): boolean {
    return vscode.workspace.getConfiguration('devops').get<boolean>('readOnly', false);
}

function checkWritePermission(): void {
    if (isReadOnlyMode()) {
        throw new ReadOnlyError();
    }
}

async function showError(err: unknown): Promise<void> {
    if (err instanceof UserError) {
        const action = err.suggestion ? await vscode.window.showErrorMessage(
            err.message,
            err.suggestion
        ) : await vscode.window.showErrorMessage(err.message);
        
        if (action === err.suggestion && err instanceof AuthError) {
            showChannel();
        }
    } else if (err instanceof Error) {
        vscode.window.showErrorMessage(err.message);
    } else {
        vscode.window.showErrorMessage('Ein unbekannter Fehler ist aufgetreten.');
    }
}

async function confirmAction(message: string): Promise<boolean> {
    const result = await vscode.window.showWarningMessage(
        message,
        { modal: true },
        'Ja, fortfahren',
        'Abbrechen'
    );
    return result === 'Ja, fortfahren';
}

export function registerBridgeCommands(
    context: vscode.ExtensionContext, 
    pm: ProviderManager,
    ionosProvider: IonosDnsProvider,
    hetznerProvider: HetznerCloudProvider,
    onAccountsChanged: () => void
) {
    context.subscriptions.push(
        // =============================================
        // DNS OPERATIONS
        // =============================================
        vscode.commands.registerCommand('devops.copyServerIp', async (node: ServerTreeItem) => {
            clipboardIp = node.publicIp;
            if (clipboardIp) {
                await vscode.env.clipboard.writeText(clipboardIp);
                vscode.window.showInformationMessage(`📋 IP ${clipboardIp} kopiert (DevOps + System Clipboard)`);
            } else {
                vscode.window.showWarningMessage('Dieser Server hat keine Public IP.');
            }
        }),

        vscode.commands.registerCommand('devops.updateRecordFromClipboard', async (node: RecordTreeItem) => {
            try {
                checkWritePermission();
                
                if (!clipboardIp) {
                    vscode.window.showWarningMessage('Keine IP im DevOps-Clipboard. Bitte erst von einem Server kopieren.');
                    return;
                }

                const confirmed = await confirmAction(
                    `DNS Record '${node.record.name}' auf ${clipboardIp} setzen?`
                );
                if (!confirmed) return;

                await ionosProvider.updateRecord(node.domainId, node.record.id, clipboardIp, undefined, node.accountId);
                vscode.window.showInformationMessage(`✅ ${node.record.name}.${node.domainName} → ${clipboardIp}`);
                onAccountsChanged();
            } catch (err) {
                logError(TAG, 'updateRecordFromClipboard failed', err);
                await showError(err);
            }
        }),

        vscode.commands.registerCommand('devops.editRecord', async (node: RecordTreeItem) => {
            try {
                checkWritePermission();

                const newValue = await vscode.window.showInputBox({
                    prompt: `Neuen Wert für ${node.record.type} Record '${node.record.name}' eingeben`,
                    value: node.record.value,
                    placeHolder: node.record.type === 'A' ? 'z.B. 192.168.1.1' : 'Neuer Wert'
                });

                if (!newValue || newValue === node.record.value) return;

                await ionosProvider.updateRecord(node.domainId, node.record.id, newValue, undefined, node.accountId);
                vscode.window.showInformationMessage(`✅ Record aktualisiert: ${newValue}`);
                onAccountsChanged();
            } catch (err) {
                logError(TAG, 'editRecord failed', err);
                await showError(err);
            }
        }),

        vscode.commands.registerCommand('devops.setTtl60', async (node: RecordTreeItem) => {
            await setRecordTtl(node, 60, ionosProvider, onAccountsChanged);
        }),

        vscode.commands.registerCommand('devops.setTtl3600', async (node: RecordTreeItem) => {
            await setRecordTtl(node, 3600, ionosProvider, onAccountsChanged);
        }),

        vscode.commands.registerCommand('devops.checkPropagation', async (node: RecordTreeItem) => {
            if (node.record.type !== 'A' && node.record.type !== 'AAAA') {
                vscode.window.showWarningMessage('Propagation Check nur für A/AAAA Records verfügbar.');
                return;
            }

            vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `DNS Propagation Check für ${node.record.name}.${node.domainName}`,
                cancellable: false
            }, async () => {
                const results = await checkDnsPropagation(
                    node.domainName, 
                    node.record.name, 
                    node.record.value
                );
                const message = formatPropagationResults(results, node.record.value);
                vscode.window.showInformationMessage(message, { modal: true });
            });
        }),

        // =============================================
        // COMPUTE OPERATIONS
        // =============================================
        vscode.commands.registerCommand('devops.serverReboot', async (node: ServerTreeItem) => {
            try {
                checkWritePermission();
                
                const confirmed = await confirmAction(
                    `Server '${node.server.name}' neu starten (Soft Reboot)?`
                );
                if (!confirmed) return;

                await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: `Starte ${node.server.name} neu...`
                }, async () => {
                    await hetznerProvider.rebootServer(node.server.id, node.accountId);
                });

                vscode.window.showInformationMessage(`✅ ${node.server.name} wird neu gestartet.`);
                onAccountsChanged();
            } catch (err) {
                logError(TAG, 'serverReboot failed', err);
                await showError(err);
            }
        }),

        vscode.commands.registerCommand('devops.serverPowerOff', async (node: ServerTreeItem) => {
            try {
                checkWritePermission();
                
                const confirmed = await confirmAction(
                    `⚠️ Server '${node.server.name}' herunterfahren?\n\nDer Server wird ausgeschaltet und ist nicht mehr erreichbar.`
                );
                if (!confirmed) return;

                await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: `Fahre ${node.server.name} herunter...`
                }, async () => {
                    await hetznerProvider.powerOffServer(node.server.id, node.accountId);
                });

                vscode.window.showInformationMessage(`✅ ${node.server.name} wurde heruntergefahren.`);
                onAccountsChanged();
            } catch (err) {
                logError(TAG, 'serverPowerOff failed', err);
                await showError(err);
            }
        }),

        vscode.commands.registerCommand('devops.serverPowerOn', async (node: ServerTreeItem) => {
            try {
                checkWritePermission();

                await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: `Starte ${node.server.name}...`
                }, async () => {
                    await hetznerProvider.powerOnServer(node.server.id, node.accountId);
                });

                vscode.window.showInformationMessage(`✅ ${node.server.name} wird gestartet.`);
                onAccountsChanged();
            } catch (err) {
                logError(TAG, 'serverPowerOn failed', err);
                await showError(err);
            }
        }),

        vscode.commands.registerCommand('devops.serverReset', async (node: ServerTreeItem) => {
            try {
                checkWritePermission();
                
                const confirmed = await confirmAction(
                    `🔴 HARD RESET für '${node.server.name}' durchführen?\n\n⚠️ Dies ist wie den Stecker ziehen! Ungespeicherte Daten gehen verloren.`
                );
                if (!confirmed) return;

                await hetznerProvider.resetServer(node.server.id, node.accountId);
                vscode.window.showInformationMessage(`✅ ${node.server.name} wurde zurückgesetzt.`);
                onAccountsChanged();
            } catch (err) {
                logError(TAG, 'serverReset failed', err);
                await showError(err);
            }
        }),

        vscode.commands.registerCommand('devops.serverRescue', async (node: ServerTreeItem) => {
            try {
                checkWritePermission();
                
                const confirmed = await confirmAction(
                    `Rescue Mode für '${node.server.name}' aktivieren?\n\nDer Server wird neu gestartet und bootet in ein temporäres Linux-System.`
                );
                if (!confirmed) return;

                const result = await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: `Aktiviere Rescue Mode für ${node.server.name}...`
                }, async () => {
                    return await hetznerProvider.enableRescueMode(node.server.id, node.accountId);
                });

                if (result.rootPassword) {
                    await vscode.env.clipboard.writeText(result.rootPassword);
                    vscode.window.showInformationMessage(
                        `✅ Rescue Mode aktiviert!\n\nRoot-Passwort wurde in die Zwischenablage kopiert: ${result.rootPassword}\n\nServer wird jetzt neu gestartet.`,
                        { modal: true }
                    );
                    await hetznerProvider.rebootServer(node.server.id, node.accountId);
                }
                
                onAccountsChanged();
            } catch (err) {
                logError(TAG, 'serverRescue failed', err);
                await showError(err);
            }
        }),

        vscode.commands.registerCommand('devops.serverSnapshot', async (node: ServerTreeItem) => {
            try {
                checkWritePermission();
                
                const snapshotName = await vscode.window.showInputBox({
                    prompt: 'Name für den Snapshot (optional)',
                    placeHolder: `Snapshot-${new Date().toISOString().slice(0, 10)}`
                });

                if (snapshotName === undefined) return;

                const confirmed = await confirmAction(
                    `Snapshot für '${node.server.name}' erstellen?\n\n⚠️ Dies kann einige Minuten dauern und Kosten verursachen.`
                );
                if (!confirmed) return;

                await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: `Erstelle Snapshot für ${node.server.name}...`,
                    cancellable: false
                }, async () => {
                    await hetznerProvider.createSnapshot(node.server.id, snapshotName || undefined, node.accountId);
                });

                vscode.window.showInformationMessage(`✅ Snapshot für ${node.server.name} wird erstellt.`);
            } catch (err) {
                logError(TAG, 'serverSnapshot failed', err);
                await showError(err);
            }
        }),

        vscode.commands.registerCommand('devops.serverSsh', async (node: ServerTreeItem) => {
            if (!node.publicIp) {
                vscode.window.showWarningMessage('Server hat keine öffentliche IP.');
                return;
            }

            const terminal = vscode.window.createTerminal({
                name: `SSH: ${node.server.name}`,
                shellPath: 'ssh',
                shellArgs: [`root@${node.publicIp}`]
            });
            terminal.show();
            logInfo(TAG, `Opened SSH terminal for ${node.server.name} (${node.publicIp})`);
        }),

        vscode.commands.registerCommand('devops.serverConsole', async (node: ServerTreeItem) => {
            const consoleUrl = `https://console.hetzner.cloud/servers/${node.server.id}/overview`;
            vscode.env.openExternal(vscode.Uri.parse(consoleUrl));
            logInfo(TAG, `Opened Hetzner Console for ${node.server.name}`);
        }),

        // =============================================
        // UTILITIES
        // =============================================
        vscode.commands.registerCommand('devops.showLogs', () => {
            showChannel();
        }),

        // Legacy commands (redirect to new account system)
        vscode.commands.registerCommand('devops.setIonosToken', () => {
            vscode.commands.executeCommand('devops.addAccount');
        }),

        vscode.commands.registerCommand('devops.setHetznerToken', () => {
            vscode.commands.executeCommand('devops.addAccount');
        }),

        vscode.commands.registerCommand('devops.clearIonosToken', () => {
            vscode.commands.executeCommand('devops.deleteAccount');
        }),

        vscode.commands.registerCommand('devops.clearHetznerToken', () => {
            vscode.commands.executeCommand('devops.deleteAccount');
        })
    );
}

async function setRecordTtl(
    node: RecordTreeItem, 
    ttl: number, 
    ionosProvider: IonosDnsProvider,
    onAccountsChanged: () => void
): Promise<void> {
    try {
        checkWritePermission();

        await ionosProvider.setRecordTtl(node.domainId, node.record.id, ttl, node.accountId);
        vscode.window.showInformationMessage(`✅ TTL auf ${ttl}s gesetzt.`);
        onAccountsChanged();
    } catch (err) {
        logError(TAG, `setTtl${ttl} failed`, err);
        await showError(err);
    }
}
