import * as vscode from 'vscode';
import { logInfo, logDebug, logError } from '../util/logging';

const TAG = 'Accounts';
const ACCOUNTS_KEY = 'devops.accounts';

/**
 * Available provider types for accounts.
 */
export type AccountProviderType = 
    | 'ionos-dns' 
    | 'ionos-cloud' 
    | 'hetzner-cloud' 
    | 'hetzner-robot'
    | 'cloudflare'
    | 'aws-route53'
    | 'digitalocean'
    | 'google-dns'
    | 'google-compute'
    | 'github';

/**
 * Available colors for account identification.
 */
export type AccountColor = 
    | 'green' 
    | 'blue' 
    | 'purple' 
    | 'orange' 
    | 'red' 
    | 'yellow' 
    | 'cyan' 
    | 'pink';

/**
 * Maps color names to VS Code theme colors.
 */
export const AccountColorMap: Record<AccountColor, string> = {
    green: 'charts.green',
    blue: 'charts.blue',
    purple: 'charts.purple',
    orange: 'charts.orange',
    red: 'charts.red',
    yellow: 'charts.yellow',
    cyan: 'terminal.ansiCyan',
    pink: 'terminal.ansiMagenta'
};

/**
 * Human-readable color labels (German).
 */
export const AccountColorLabels: Record<AccountColor, string> = {
    green: '🟢 Grün',
    blue: '🔵 Blau',
    purple: '🟣 Lila',
    orange: '🟠 Orange',
    red: '🔴 Rot',
    yellow: '🟡 Gelb',
    cyan: '🔵 Cyan',
    pink: '💗 Pink'
};

/**
 * Provider display names.
 */
export const ProviderLabels: Record<AccountProviderType, string> = {
    'ionos-dns': 'IONOS DNS',
    'ionos-cloud': 'IONOS Cloud',
    'hetzner-cloud': 'Hetzner Cloud',
    'hetzner-robot': 'Hetzner Robot (Dedicated)',
    'cloudflare': 'Cloudflare',
    'aws-route53': 'AWS Route 53',
    'digitalocean': 'DigitalOcean',
    'google-dns': 'Google Cloud DNS',
    'google-compute': 'Google Compute Engine',
    'github': 'GitHub'
};

/**
 * Represents a configured account/credential set.
 */
export interface Account {
    id: string;
    name: string;
    provider: AccountProviderType;
    color: AccountColor;
    isDefault?: boolean;
    createdAt: number;
}

/**
 * Account metadata stored in globalState (without secrets).
 */
interface AccountsStore {
    accounts: Account[];
}

/**
 * Manages multiple accounts/credentials for all providers.
 */
export class AccountManager {
    private accounts: Account[] = [];

    constructor(
        private globalState: vscode.Memento,
        private secrets: vscode.SecretStorage
    ) {}

    /**
     * Initialize the account manager by loading saved accounts.
     */
    async initialize(): Promise<void> {
        const stored = this.globalState.get<AccountsStore>(ACCOUNTS_KEY);
        this.accounts = stored?.accounts || [];
        logInfo(TAG, `Loaded ${this.accounts.length} accounts`);
    }

    /**
     * Get all accounts.
     */
    getAll(): Account[] {
        return [...this.accounts];
    }

    /**
     * Get accounts filtered by provider type.
     */
    getByProvider(provider: AccountProviderType): Account[] {
        return this.accounts.filter(a => a.provider === provider);
    }

    /**
     * Get a specific account by ID.
     */
    getById(id: string): Account | undefined {
        return this.accounts.find(a => a.id === id);
    }

    /**
     * Add a new account.
     */
    async addAccount(
        name: string,
        provider: AccountProviderType,
        token: string,
        color: AccountColor,
        isDefault: boolean = false
    ): Promise<Account> {
        const id = `${provider}-${Date.now()}`;
        
        const account: Account = {
            id,
            name,
            provider,
            color,
            isDefault,
            createdAt: Date.now()
        };

        // If this is default, unset other defaults for same provider
        if (isDefault) {
            this.accounts
                .filter(a => a.provider === provider && a.isDefault)
                .forEach(a => a.isDefault = false);
        }

        this.accounts.push(account);
        
        // Store token securely
        await this.secrets.store(`devops.token.${id}`, token);
        
        // Save metadata
        await this.save();
        
        logInfo(TAG, `Added account: ${name} (${provider})`);
        return account;
    }

    /**
     * Update an existing account.
     */
    async updateAccount(
        id: string,
        updates: Partial<Pick<Account, 'name' | 'color' | 'isDefault'>>
    ): Promise<void> {
        const account = this.accounts.find(a => a.id === id);
        if (!account) {
            throw new Error(`Account ${id} not found`);
        }

        if (updates.name !== undefined) account.name = updates.name;
        if (updates.color !== undefined) account.color = updates.color;
        
        if (updates.isDefault) {
            // Unset other defaults for same provider
            this.accounts
                .filter(a => a.provider === account.provider && a.id !== id && a.isDefault)
                .forEach(a => a.isDefault = false);
            account.isDefault = true;
        }

        await this.save();
        logInfo(TAG, `Updated account: ${account.name}`);
    }

    /**
     * Update the token for an account.
     */
    async updateToken(id: string, token: string): Promise<void> {
        const account = this.accounts.find(a => a.id === id);
        if (!account) {
            throw new Error(`Account ${id} not found`);
        }

        await this.secrets.store(`devops.token.${id}`, token);
        logInfo(TAG, `Updated token for account: ${account.name}`);
    }

    /**
     * Delete an account and its token.
     */
    async deleteAccount(id: string): Promise<void> {
        const index = this.accounts.findIndex(a => a.id === id);
        if (index === -1) {
            throw new Error(`Account ${id} not found`);
        }

        const account = this.accounts[index];
        this.accounts.splice(index, 1);
        
        await this.secrets.delete(`devops.token.${id}`);
        await this.save();
        
        logInfo(TAG, `Deleted account: ${account.name}`);
    }

    /**
     * Get the token for an account.
     */
    async getToken(id: string): Promise<string | undefined> {
        return this.secrets.get(`devops.token.${id}`);
    }

    /**
     * Get the default account for a provider, or the first one.
     */
    getDefaultForProvider(provider: AccountProviderType): Account | undefined {
        const providerAccounts = this.getByProvider(provider);
        return providerAccounts.find(a => a.isDefault) || providerAccounts[0];
    }

    /**
     * Check if any accounts exist for a provider.
     */
    hasAccountsForProvider(provider: AccountProviderType): boolean {
        return this.accounts.some(a => a.provider === provider);
    }

    /**
     * Save accounts to global state.
     */
    private async save(): Promise<void> {
        await this.globalState.update(ACCOUNTS_KEY, { accounts: this.accounts });
        logDebug(TAG, `Saved ${this.accounts.length} accounts`);
    }

    /**
     * Migrate from old single-token storage to new multi-account system.
     */
    async migrateFromLegacy(): Promise<boolean> {
        let migrated = false;

        // Check for legacy IONOS token
        const legacyIonosToken = await this.secrets.get('ionos.dns.token');
        if (legacyIonosToken && !this.hasAccountsForProvider('ionos-dns')) {
            await this.addAccount('IONOS (migriert)', 'ionos-dns', legacyIonosToken, 'blue', true);
            await this.secrets.delete('ionos.dns.token');
            migrated = true;
            logInfo(TAG, 'Migrated legacy IONOS token');
        }

        // Check for legacy Hetzner token
        const legacyHetznerToken = await this.secrets.get('hetzner.cloud.token');
        if (legacyHetznerToken && !this.hasAccountsForProvider('hetzner-cloud')) {
            await this.addAccount('Hetzner (migriert)', 'hetzner-cloud', legacyHetznerToken, 'orange', true);
            await this.secrets.delete('hetzner.cloud.token');
            migrated = true;
            logInfo(TAG, 'Migrated legacy Hetzner token');
        }

        return migrated;
    }
}
