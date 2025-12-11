import * as vscode from 'vscode';
import { 
    AccountManager, 
    AccountProviderType, 
    AccountColor, 
    AccountColorLabels, 
    ProviderLabels,
    Account,
    AccountColorMap
} from '../core/accounts';
import { logInfo, logError } from '../util/logging';

const TAG = 'AccountCommands';

/**
 * Register all account management commands.
 */
export function registerAccountCommands(
    context: vscode.ExtensionContext,
    accountManager: AccountManager,
    onAccountsChanged: () => Promise<void>
) {
    context.subscriptions.push(
        // =============================================
        // ADD ACCOUNT
        // =============================================
        vscode.commands.registerCommand('devops.addAccount', async () => {
            try {
                // Step 1: Select Provider
                const providerOptions: vscode.QuickPickItem[] = [
                    { label: '🌐 IONOS DNS', description: 'Domain & DNS Management', detail: 'ionos-dns' },
                    { label: '☁️ Hetzner Cloud', description: 'Cloud Server Management', detail: 'hetzner-cloud' },
                    { label: '🔶 Cloudflare', description: 'DNS & CDN', detail: 'cloudflare' },
                    { label: '🔴 Google Cloud DNS', description: 'Google Cloud Platform DNS', detail: 'google-dns' },
                    { label: '🟠 AWS Route 53', description: 'Amazon Web Services DNS', detail: 'aws-route53' },
                    { label: '🔵 DigitalOcean', description: 'Cloud & DNS (coming soon)', detail: 'digitalocean' },
                ];

                const selectedProvider = await vscode.window.showQuickPick(providerOptions, {
                    placeHolder: 'Wählen Sie einen Provider',
                    title: 'Neuen Account hinzufügen (1/4)'
                });

                if (!selectedProvider) return;

                const provider = selectedProvider.detail as AccountProviderType;

                // Check if provider is available
                if (!['ionos-dns', 'hetzner-cloud', 'cloudflare', 'google-dns', 'aws-route53'].includes(provider)) {
                    vscode.window.showInformationMessage(`${selectedProvider.label} wird bald verfügbar sein!`);
                    return;
                }

                // Step 2: Enter Name
                const name = await vscode.window.showInputBox({
                    prompt: 'Geben Sie einen Namen für diesen Account ein',
                    placeHolder: 'z.B. "Kunde: MeineAgentur" oder "Privat"',
                    title: 'Neuen Account hinzufügen (2/4)',
                    validateInput: (value) => {
                        if (!value || value.trim().length < 2) {
                            return 'Name muss mindestens 2 Zeichen haben';
                        }
                        return null;
                    }
                });

                if (!name) return;

                // Step 3: Select Color
                const colorOptions: vscode.QuickPickItem[] = Object.entries(AccountColorLabels).map(
                    ([key, label]) => ({
                        label,
                        detail: key
                    })
                );

                const selectedColor = await vscode.window.showQuickPick(colorOptions, {
                    placeHolder: 'Wählen Sie eine Farbe zur Identifikation',
                    title: 'Neuen Account hinzufügen (3/4)'
                });

                if (!selectedColor) return;

                const color = selectedColor.detail as AccountColor;

                // Step 4: Enter Token
                const tokenPrompts: Record<string, string> = {
                    'ionos-dns': 'IONOS API Key (Format: public.secret)',
                    'hetzner-cloud': 'Hetzner Cloud API Token',
                    'cloudflare': 'Cloudflare API Token',
                    'google-dns': 'Google Service Account JSON Key (komplett einfügen)',
                    'aws-route53': 'AWS Access Key ID:Secret Access Key (mit Doppelpunkt getrennt)'
                };

                // For IONOS, offer to open developer console
                if (provider === 'ionos-dns') {
                    const openConsole = await vscode.window.showQuickPick([
                        { label: '$(link-external) IONOS Developer Console öffnen', detail: 'open' },
                        { label: '$(key) API Key direkt eingeben', detail: 'enter' }
                    ], {
                        placeHolder: 'Wie möchten Sie fortfahren?',
                        title: 'Neuen Account hinzufügen (4/4)'
                    });

                    if (!openConsole) return;

                    if (openConsole.detail === 'open') {
                        await vscode.env.openExternal(vscode.Uri.parse('https://developer.hosting.ionos.de/keys'));
                        vscode.window.showInformationMessage('IONOS Developer Console geöffnet. Erstellen Sie einen neuen API-Key und fügen Sie ihn dann hier ein.');
                        logInfo(TAG, 'Opened IONOS Developer Console for API key creation');
                    }
                }

                const token = await vscode.window.showInputBox({
                    prompt: tokenPrompts[provider] || 'API Token eingeben',
                    placeHolder: provider === 'ionos-dns' ? 'public.secret hier einfügen...' : 'Token hier einfügen...',
                    title: 'Neuen Account hinzufügen (4/4)',
                    password: true,
                    ignoreFocusOut: true,
                    validateInput: (value) => {
                        if (!value || value.trim().length < 10) {
                            return 'Token scheint zu kurz zu sein';
                        }
                        if (provider === 'ionos-dns' && !value.includes('.')) {
                            return 'IONOS API Key sollte Format "public.secret" haben';
                        }
                        return null;
                    }
                });

                if (!token) return;

                // Check if this should be default
                const existingAccounts = accountManager.getByProvider(provider);
                const isDefault = existingAccounts.length === 0;

                // Create account
                const account = await accountManager.addAccount(name.trim(), provider, token.trim(), color, isDefault);

                vscode.window.showInformationMessage(`✅ Account "${name}" hinzugefügt!`);
                logInfo(TAG, `Added account: ${name} (${provider})`);
                
                await onAccountsChanged();
            } catch (err) {
                logError(TAG, 'Failed to add account', err);
                vscode.window.showErrorMessage(`Fehler: ${err}`);
            }
        }),

        // =============================================
        // EDIT ACCOUNT
        // =============================================
        vscode.commands.registerCommand('devops.editAccount', async (accountOrId?: Account | string) => {
            try {
                let account: Account | undefined;

                if (typeof accountOrId === 'string') {
                    account = accountManager.getById(accountOrId);
                } else if (accountOrId) {
                    account = accountOrId;
                } else {
                    // Show picker
                    const accounts = accountManager.getAll();
                    if (accounts.length === 0) {
                        vscode.window.showInformationMessage('Keine Accounts vorhanden.');
                        return;
                    }

                    const options = accounts.map(a => ({
                        label: `${AccountColorLabels[a.color].split(' ')[0]} ${a.name}`,
                        description: ProviderLabels[a.provider],
                        detail: a.id
                    }));

                    const selected = await vscode.window.showQuickPick(options, {
                        placeHolder: 'Welchen Account bearbeiten?'
                    });

                    if (!selected) return;
                    account = accountManager.getById(selected.detail!);
                }

                if (!account) {
                    vscode.window.showErrorMessage('Account nicht gefunden.');
                    return;
                }

                // What to edit?
                const editOptions = [
                    { label: '📝 Name ändern', detail: 'name' },
                    { label: '🎨 Farbe ändern', detail: 'color' },
                    { label: '🔑 Token aktualisieren', detail: 'token' },
                    { label: '⭐ Als Standard setzen', detail: 'default' }
                ];

                const editChoice = await vscode.window.showQuickPick(editOptions, {
                    placeHolder: `Was möchten Sie an "${account.name}" ändern?`
                });

                if (!editChoice) return;

                switch (editChoice.detail) {
                    case 'name': {
                        const newName = await vscode.window.showInputBox({
                            prompt: 'Neuer Name',
                            value: account.name
                        });
                        if (newName && newName !== account.name) {
                            await accountManager.updateAccount(account.id, { name: newName });
                            vscode.window.showInformationMessage(`✅ Name geändert zu "${newName}"`);
                        }
                        break;
                    }
                    case 'color': {
                        const colorOptions = Object.entries(AccountColorLabels).map(
                            ([key, label]) => ({ label, detail: key })
                        );
                        const newColor = await vscode.window.showQuickPick(colorOptions, {
                            placeHolder: 'Neue Farbe wählen'
                        });
                        if (newColor) {
                            await accountManager.updateAccount(account.id, { color: newColor.detail as AccountColor });
                            vscode.window.showInformationMessage(`✅ Farbe geändert!`);
                        }
                        break;
                    }
                    case 'token': {
                        const newToken = await vscode.window.showInputBox({
                            prompt: 'Neuer Token',
                            password: true,
                            ignoreFocusOut: true
                        });
                        if (newToken) {
                            await accountManager.updateToken(account.id, newToken);
                            vscode.window.showInformationMessage(`✅ Token aktualisiert!`);
                        }
                        break;
                    }
                    case 'default': {
                        await accountManager.updateAccount(account.id, { isDefault: true });
                        vscode.window.showInformationMessage(`✅ "${account.name}" ist jetzt der Standard-Account!`);
                        break;
                    }
                }

                await onAccountsChanged();
            } catch (err) {
                logError(TAG, 'Failed to edit account', err);
                vscode.window.showErrorMessage(`Fehler: ${err}`);
            }
        }),

        // =============================================
        // OPEN IONOS DEVELOPER CONSOLE
        // =============================================
        vscode.commands.registerCommand('devops.openIonosDeveloperConsole', async () => {
            try {
                const url = 'https://developer.hosting.ionos.de/keys';
                await vscode.env.openExternal(vscode.Uri.parse(url));
                vscode.window.showInformationMessage('IONOS Developer Console geöffnet. Dort können Sie neue API-Keys erstellen.');
                logInfo(TAG, 'Opened IONOS Developer Console');
            } catch (err) {
                logError(TAG, 'Failed to open IONOS Developer Console', err);
                vscode.window.showErrorMessage(`Fehler beim Öffnen: ${err}`);
            }
        }),

        // =============================================
        // DELETE ACCOUNT
        // =============================================
        vscode.commands.registerCommand('devops.deleteAccount', async (accountOrId?: Account | string) => {
            try {
                let account: Account | undefined;

                if (typeof accountOrId === 'string') {
                    account = accountManager.getById(accountOrId);
                } else if (accountOrId) {
                    account = accountOrId;
                } else {
                    // Show picker
                    const accounts = accountManager.getAll();
                    if (accounts.length === 0) {
                        vscode.window.showInformationMessage('Keine Accounts vorhanden.');
                        return;
                    }

                    const options = accounts.map(a => ({
                        label: `${AccountColorLabels[a.color].split(' ')[0]} ${a.name}`,
                        description: ProviderLabels[a.provider],
                        detail: a.id
                    }));

                    const selected = await vscode.window.showQuickPick(options, {
                        placeHolder: 'Welchen Account löschen?'
                    });

                    if (!selected) return;
                    account = accountManager.getById(selected.detail!);
                }

                if (!account) {
                    vscode.window.showErrorMessage('Account nicht gefunden.');
                    return;
                }

                const confirm = await vscode.window.showWarningMessage(
                    `Account "${account.name}" wirklich löschen?\n\nDer API-Token wird unwiderruflich entfernt.`,
                    { modal: true },
                    'Ja, löschen',
                    'Abbrechen'
                );

                if (confirm !== 'Ja, löschen') return;

                await accountManager.deleteAccount(account.id);
                vscode.window.showInformationMessage(`✅ Account "${account.name}" gelöscht.`);
                
                await onAccountsChanged();
            } catch (err) {
                logError(TAG, 'Failed to delete account', err);
                vscode.window.showErrorMessage(`Fehler: ${err}`);
            }
        }),

        // =============================================
        // LIST ACCOUNTS
        // =============================================
        vscode.commands.registerCommand('devops.listAccounts', async () => {
            const accounts = accountManager.getAll();
            
            if (accounts.length === 0) {
                const add = await vscode.window.showInformationMessage(
                    'Keine Accounts konfiguriert.',
                    'Account hinzufügen'
                );
                if (add) {
                    vscode.commands.executeCommand('devops.addAccount');
                }
                return;
            }

            const options = accounts.map(a => ({
                label: `${AccountColorLabels[a.color].split(' ')[0]} ${a.name}${a.isDefault ? ' ⭐' : ''}`,
                description: ProviderLabels[a.provider],
                detail: a.id
            }));

            options.push({ label: '$(add) Neuen Account hinzufügen', description: '', detail: '__add__' });

            const selected = await vscode.window.showQuickPick(options, {
                placeHolder: 'Accounts verwalten'
            });

            if (!selected) return;

            if (selected.detail === '__add__') {
                vscode.commands.executeCommand('devops.addAccount');
            } else {
                vscode.commands.executeCommand('devops.editAccount', selected.detail);
            }
        })
    );
}
